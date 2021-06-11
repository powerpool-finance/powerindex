// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@powerpool/poweroracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interfaces/IYearnVaultV2.sol";
import "../interfaces/PowerIndexPoolControllerInterface.sol";
import "../interfaces/ICurveDepositor.sol";
import "../interfaces/ICurveDepositor2.sol";
import "../interfaces/ICurveDepositor3.sol";
import "../interfaces/ICurveDepositor4.sol";
import "../interfaces/ICurveZapDepositor.sol";
import "../interfaces/ICurveZapDepositor2.sol";
import "../interfaces/ICurveZapDepositor3.sol";
import "../interfaces/ICurveZapDepositor4.sol";
import "../interfaces/ICurvePoolRegistry.sol";
import "./blocks/SinglePoolManagement.sol";
import "./WeightValueChangeRateAbstract.sol";

contract YearnVaultInstantRebindStrategy is SinglePoolManagement, WeightValueChangeRateAbstract {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;

  event ChangePoolTokens(address[] poolTokensBefore, address[] poolTokensAfter);
  event InstantRebind(uint256 poolCurrentTokensCount, uint256 usdcPulled, uint256 usdcRemainder);
  event UpdatePool(address[] poolTokensBefore, address[] poolTokensAfter);
  event VaultWithdrawFee(address indexed vaultToken, uint256 crvAmount);
  event SeizeERC20(address indexed token, address indexed to, uint256 amount);
  event SetMaxWithdrawalLoss(uint256 maxWithdrawalLoss);

  event PullLiquidity(
    address indexed vaultToken,
    address crvToken,
    uint256 vaultAmount,
    uint256 crvAmountExpected,
    uint256 crvAmountActual,
    uint256 usdcAmount,
    uint256 vaultReserve
  );

  event PushLiquidity(
    address indexed vaultToken,
    address crvToken,
    uint256 vaultAmount,
    uint256 crvAmount,
    uint256 usdcAmount
  );

  event SetPoolController(address indexed poolController);

  event SetCurvePoolRegistry(address curvePoolRegistry);

  event SetVaultConfig(
    address indexed vault,
    address indexed depositor,
    uint8 depositorType,
    uint8 depositorTokenLength,
    int8 usdcIndex
  );

  event SetStrategyConstraints(uint256 minUSDCRemainder, bool useVirtualPriceEstimation);

  struct RebindConfig {
    address token;
    uint256 newWeight;
    uint256 oldBalance;
    uint256 newBalance;
  }

  struct VaultConfig {
    address depositor;
    uint8 depositorType;
    uint8 depositorTokenLength;
    int8 usdcIndex;
  }

  struct StrategyConstraints {
    uint256 minUSDCRemainder;
    bool useVirtualPriceEstimation;
  }

  struct PullDataHelper {
    address crvToken;
    uint256 yDiff;
    uint256 ycrvBalance;
    uint256 crvExpected;
    uint256 crvActual;
    uint256 usdcBefore;
    uint256 vaultReserve;
  }

  IERC20 public immutable USDC;

  IPowerPoke public powerPoke;
  ICurvePoolRegistry public curvePoolRegistry;
  uint256 public lastUpdate;
  uint256 public maxWithdrawalLoss;

  StrategyConstraints public constraints;

  address[] internal poolTokens;
  mapping(address => VaultConfig) public vaultConfig;

  modifier onlyEOA() {
    require(msg.sender == tx.origin, "ONLY_EOA");
    _;
  }

  modifier onlyReporter(uint256 _reporterId, bytes calldata _rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeReporter(_reporterId, msg.sender);
    _;
    _reward(_reporterId, gasStart, COMPENSATION_PLAN_1_ID, _rewardOpts);
  }

  modifier onlyNonReporter(uint256 _reporterId, bytes calldata _rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeNonReporter(_reporterId, msg.sender);
    _;
    _reward(_reporterId, gasStart, COMPENSATION_PLAN_1_ID, _rewardOpts);
  }

  constructor(address _pool, address _usdc) public SinglePoolManagement(_pool) OwnableUpgradeSafe() {
    USDC = IERC20(_usdc);
  }

  function initialize(
    address _powerPoke,
    address _curvePoolRegistry,
    address _poolController,
    uint256 _maxWithdrawalLoss,
    StrategyConstraints memory _constraints
  ) external initializer {
    __Ownable_init();

    __SinglePoolManagement_init(_poolController);

    maxWithdrawalLoss = _maxWithdrawalLoss;
    powerPoke = IPowerPoke(_powerPoke);
    curvePoolRegistry = ICurvePoolRegistry(_curvePoolRegistry);
    constraints = _constraints;
    totalWeight = 25 * BONE;
  }

  /*** GETTERS ***/
  function getTokenValue(PowerIndexPoolInterface, address _token) public view override returns (uint256 value) {
    value = getVaultVirtualPriceEstimation(_token, IYearnVaultV2(_token).totalAssets());
    (, uint256 newValueChangeRate) = getValueChangeRate(_token, lastValue[_token], value);
    if (newValueChangeRate != 0) {
      value = bmul(value, newValueChangeRate);
    }
  }

  function getVaultVirtualPriceEstimation(address _token, uint256 _amount) public view returns (uint256) {
    return
      ICurvePoolRegistry(curvePoolRegistry).get_virtual_price_from_lp_token(IYearnVaultV2(_token).token()).mul(
        _amount
      ) / 1e18;
  }

  function getVaultUsdcEstimation(address _token, address _crvToken, uint256 _amount) public view returns (uint256) {
    VaultConfig memory vc = vaultConfig[_token];
    if (vc.depositorType == 2) {
      return ICurveZapDepositor(vc.depositor).calc_withdraw_one_coin(_crvToken, _amount, int128(vc.usdcIndex));
    } else {
      return ICurveDepositor(vc.depositor).calc_withdraw_one_coin(_amount, int128(vc.usdcIndex));
    }
  }

  function getPoolTokens() public view returns (address[] memory) {
    return poolTokens;
  }

  /*** OWNER'S SETTERS ***/
  function setCurvePoolRegistry(address _curvePoolRegistry) external onlyOwner {
    curvePoolRegistry = ICurvePoolRegistry(_curvePoolRegistry);
    emit SetCurvePoolRegistry(_curvePoolRegistry);
  }

  function setVaultConfig(
    address _vault,
    address _depositor,
    uint8 _depositorType,
    uint8 _depositorTokenLength,
    int8 _usdcIndex
  ) external onlyOwner {
    vaultConfig[_vault] = VaultConfig(_depositor, _depositorType, _depositorTokenLength, _usdcIndex);
    IERC20 crvToken = IERC20(IYearnVaultV2(_vault).token());
    USDC.safeApprove(_depositor, uint256(-1));
    crvToken.safeApprove(_vault, uint256(-1));
    crvToken.safeApprove(_depositor, uint256(-1));
    emit SetVaultConfig(_vault, _depositor, _depositorType, _depositorTokenLength, _usdcIndex);
  }

  function setPoolController(address _poolController) public onlyOwner {
    poolController = _poolController;
    _updatePool(poolController, _poolController);
    emit SetPoolController(_poolController);
  }

  function syncPoolTokens() external onlyOwner {
    address controller = poolController;
    _updatePool(controller, controller);
  }

  function setMaxWithdrawalLoss(uint256 _maxWithdrawalLoss) external onlyOwner {
    maxWithdrawalLoss = _maxWithdrawalLoss;
    emit SetMaxWithdrawalLoss(_maxWithdrawalLoss);
  }

  function removeApprovals(IERC20[] calldata _tokens, address[] calldata _tos) external onlyOwner {
    uint256 len = _tokens.length;

    for (uint256 i = 0; i < len; i++) {
      _tokens[i].safeApprove(_tos[i], uint256(0));
    }
  }

  function seizeERC20(
    address[] calldata _tokens,
    address[] calldata _tos,
    uint256[] calldata _amounts
  ) external onlyOwner {
    uint256 len = _tokens.length;
    require(len == _tos.length && len == _amounts.length, "LENGTHS");

    for (uint256 i = 0; i < len; i++) {
      IERC20(_tokens[i]).safeTransfer(_tos[i], _amounts[i]);
      emit SeizeERC20(_tokens[i], _tos[i], _amounts[i]);
    }
  }

  function setStrategyConstraints(StrategyConstraints memory _constraints) external onlyOwner {
    constraints = _constraints;
    emit SetStrategyConstraints(_constraints.minUSDCRemainder, _constraints.useVirtualPriceEstimation);
  }

  function _updatePool(address _oldController, address _newController) internal {
    address[] memory poolTokensBefore = poolTokens;
    uint256 len = poolTokensBefore.length;

    if (_oldController != address(0)) {
      // remove approval
      for (uint256 i = 0; i < len; i++) {
        _removeApprovalVault(poolTokensBefore[i], address(_oldController));
      }
    }

    address[] memory poolTokensAfter = PowerIndexPoolInterface(pool).getCurrentTokens();
    poolTokens = poolTokensAfter;

    // approve
    len = poolTokensAfter.length;
    for (uint256 i = 0; i < len; i++) {
      _approveVault(poolTokensAfter[i], address(_newController));
    }

    emit UpdatePool(poolTokensBefore, poolTokensAfter);
  }

  function _approveVault(address _vaultToken, address _controller) internal {
    IERC20 vaultToken = IERC20(_vaultToken);
    vaultToken.safeApprove(pool, uint256(-1));
    vaultToken.safeApprove(_controller, uint256(-1));
  }

  function _removeApprovalVault(address _vaultToken, address _controller) internal {
    IERC20 vaultToken = IERC20(_vaultToken);
    vaultToken.safeApprove(pool, uint256(0));
    vaultToken.safeApprove(_controller, uint256(0));
  }

  function changePoolTokens(address[] memory _newTokens) external onlyOwner {
    address[] memory _currentTokens = BPoolInterface(pool).getCurrentTokens();
    uint256 cLen = _currentTokens.length;
    uint256 nLen = _newTokens.length;
    for (uint256 i = 0; i < cLen; i++) {
      bool existsInNewTokens = false;
      for (uint256 j = 0; j < nLen; j++) {
        if (_currentTokens[i] == _newTokens[j]) {
          existsInNewTokens = true;
        }
      }
      if (!existsInNewTokens) {
        PowerIndexPoolControllerInterface(poolController).unbindByStrategy(_currentTokens[i]);
        _vaultToUsdc(
          _currentTokens[i],
          IYearnVaultV2(_currentTokens[i]).token(),
          vaultConfig[_currentTokens[i]]
        );
        _removeApprovalVault(_currentTokens[i], address(poolController));
      }
    }

    for (uint256 j = 0; j < nLen; j++) {
      if (!BPoolInterface(pool).isBound(_newTokens[j])) {
        _approveVault(_newTokens[j], address(poolController));
      }
    }

    _instantRebind(_newTokens, true);

    emit ChangePoolTokens(_currentTokens, _newTokens);
  }

  /*** POKERS ***/
  function pokeFromReporter(uint256 _reporterId, bytes calldata _rewardOpts)
    external
    onlyReporter(_reporterId, _rewardOpts)
    onlyEOA
  {
    _poke(false);
  }

  function pokeFromSlasher(uint256 _reporterId, bytes calldata _rewardOpts)
    external
    onlyNonReporter(_reporterId, _rewardOpts)
    onlyEOA
  {
    _poke(true);
  }

  function _poke(bool _bySlasher) internal {
    (uint256 minInterval, uint256 maxInterval) = _getMinMaxReportInterval();
    require(lastUpdate + minInterval < block.timestamp, "MIN_INTERVAL_NOT_REACHED");
    if (_bySlasher) {
      require(lastUpdate + maxInterval < block.timestamp, "MAX_INTERVAL_NOT_REACHED");
    }
    lastUpdate = block.timestamp;

    _instantRebind(BPoolInterface(pool).getCurrentTokens(), false);
  }

  function _vaultToUsdc(
    address _token,
    address _crvToken,
    VaultConfig memory _vc
  )
    internal
    returns (
      uint256 crvBalance,
      uint256 crvReceived,
      uint256 usdcBefore
    )
  {
    crvBalance = IERC20(_token).balanceOf(address(this));
    uint256 crvBefore = IERC20(_crvToken).balanceOf(address(this));

    IYearnVaultV2(_token).withdraw(crvBalance, address(this), maxWithdrawalLoss);
    crvReceived = IERC20(_crvToken).balanceOf(address(this)).sub(crvBefore);

    usdcBefore = USDC.balanceOf(address(this));
    if (_vc.depositorType == 2) {
      ICurveZapDepositor(_vc.depositor).remove_liquidity_one_coin(_crvToken, crvReceived, _vc.usdcIndex, 0);
    } else {
      ICurveDepositor(_vc.depositor).remove_liquidity_one_coin(crvReceived, _vc.usdcIndex, 0);
    }
  }

  function _usdcToVault(
    address _token,
    VaultConfig memory _vc,
    uint256 _usdcAmount
  )
    internal
    returns (
      uint256 crvBalance,
      uint256 vaultBalance,
      address crvToken
    )
  {
    crvToken = IYearnVaultV2(_token).token();

    _addUSDC2CurvePool(crvToken, _vc, _usdcAmount);

    // 2nd step. Vault.deposit()
    crvBalance = IERC20(crvToken).balanceOf(address(this));
    IYearnVaultV2(_token).deposit(crvBalance);

    // 3rd step. Rebind
    vaultBalance = IERC20(_token).balanceOf(address(this));
  }

  function _instantRebind(address[] memory _tokens, bool _allowNotBound) internal {
    address poolController_ = poolController;
    require(poolController_ != address(0), "CFG_NOT_SET");

    RebindConfig[] memory configs = fetchRebindConfigs(PowerIndexPoolInterface(pool), _tokens, _allowNotBound);

    uint256 toPushUSDCTotal;
    uint256 len = configs.length;
    uint256[] memory toPushUSDC = new uint256[](len);
    VaultConfig[] memory vaultConfigs = new VaultConfig[](len);

    for (uint256 si = 0; si < len; si++) {
      RebindConfig memory cfg = configs[si];
      VaultConfig memory vc = vaultConfig[cfg.token];
      vaultConfigs[si] = vc;
      require(vc.depositor != address(0), "DEPOSIT_CONTRACT_NOT_SET");

      if (cfg.newBalance <= cfg.oldBalance) {
        PullDataHelper memory mem;
        mem.crvToken = IYearnVaultV2(cfg.token).token();
        mem.vaultReserve = IERC20(mem.crvToken).balanceOf(cfg.token);

        mem.yDiff = (cfg.oldBalance - cfg.newBalance);

        // 1st step. Rebind
        PowerIndexPoolControllerInterface(poolController_).rebindByStrategyRemove(
          cfg.token,
          cfg.newBalance,
          cfg.newWeight
        );

        // 3rd step. CurvePool.remove_liquidity_one_coin()
        (mem.ycrvBalance, mem.crvActual, mem.usdcBefore) = _vaultToUsdc(
          cfg.token,
          mem.crvToken,
          vc
        );

        // 2nd step. Vault.withdraw()
        mem.crvExpected = (mem.ycrvBalance * IYearnVaultV2(cfg.token).pricePerShare()) / 1e18;

        emit PullLiquidity(
          cfg.token,
          mem.crvToken,
          mem.yDiff,
          mem.crvExpected,
          mem.crvActual,
          USDC.balanceOf(address(this)) - mem.usdcBefore,
          mem.vaultReserve
        );
      } else {
        uint256 yDiff = cfg.newBalance - cfg.oldBalance;
        uint256 crvAmount = IYearnVaultV2(cfg.token).pricePerShare().mul(yDiff) / 1e18;
        uint256 usdcIn;

        address crvToken = IYearnVaultV2(cfg.token).token();
        if (constraints.useVirtualPriceEstimation) {
          uint256 virtualPrice =
            ICurvePoolRegistry(curvePoolRegistry).get_virtual_price_from_lp_token(crvToken);
          // usdcIn = virtualPrice * crvAmount / 1e18
          usdcIn = bmul(virtualPrice, crvAmount);
        } else {
          usdcIn = getVaultUsdcEstimation(cfg.token, crvToken, crvAmount);
        }

        // toPushUSDCTotal += usdcIn;
        toPushUSDCTotal = toPushUSDCTotal.add(usdcIn);
        toPushUSDC[si] = usdcIn;
      }
    }

    uint256 usdcPulled = USDC.balanceOf(address(this));
    require(usdcPulled > 0, "USDC_PULLED_NULL");

    for (uint256 si = 0; si < len; si++) {
      if (toPushUSDC[si] > 0) {
        RebindConfig memory cfg = configs[si];

        // 1st step. Add USDC to Curve pool
        // uint256 usdcAmount = (usdcPulled * toPushUSDC[si]) / toPushUSDCTotal;
        uint256 usdcAmount = (usdcPulled.mul(toPushUSDC[si])) / toPushUSDCTotal;

        (uint256 crvBalance, uint256 vaultBalance, address crvToken) =
          _usdcToVault(cfg.token, vaultConfigs[si], usdcAmount);

        // uint256 newBalance = IERC20(cfg.token).balanceOf(address(this)) + BPoolInterface(_pool).getBalance(cfg.token)
        uint256 newBalance;
        try BPoolInterface(pool).getBalance(cfg.token) returns (uint256 _poolBalance) {
          newBalance = IERC20(cfg.token).balanceOf(address(this)).add(_poolBalance);
        } catch {
          newBalance = IERC20(cfg.token).balanceOf(address(this));
        }
        if (cfg.oldBalance == 0) {
          require(_allowNotBound, "BIND_NOT_ALLOW");
          PowerIndexPoolControllerInterface(poolController_).bindByStrategy(cfg.token, newBalance, cfg.newWeight);
        } else {
          PowerIndexPoolControllerInterface(poolController_).rebindByStrategyAdd(
            cfg.token,
            newBalance,
            cfg.newWeight,
            vaultBalance
          );
        }
        emit PushLiquidity(cfg.token, crvToken, vaultBalance, crvBalance, usdcAmount);
      }
    }

    uint256 usdcRemainder = USDC.balanceOf(address(this));
    require(usdcRemainder <= constraints.minUSDCRemainder, "USDC_REMAINDER");

    emit InstantRebind(len, usdcPulled, usdcRemainder);
  }

  function fetchRebindConfigs(
    PowerIndexPoolInterface _pool,
    address[] memory _tokens,
    bool _allowNotBound
  ) internal returns (RebindConfig[] memory configs) {
    uint256 len = _tokens.length;
    (uint256[] memory oldBalances, uint256[] memory poolUSDCBalances, uint256 totalUSDCPool) =
      getRebindConfigBalances(_pool, _tokens);

    (uint256[3][] memory weightsChange, , uint256[] memory newTokenValuesUSDC, uint256 totalValueUSDC) =
      computeWeightsChange(_pool, _tokens, new address[](0), 0, block.timestamp, block.timestamp + 1);

    configs = new RebindConfig[](len);

    for (uint256 si = 0; si < len; si++) {
      uint256[3] memory wc = weightsChange[si];
      require(wc[1] != 0 || _allowNotBound, "TOKEN_NOT_BOUND");

      configs[si] = RebindConfig(
        _tokens[wc[0]],
        // (totalWeight * newTokenValuesUSDC[oi]) / totalValueUSDC,
        wc[2],
        oldBalances[wc[0]],
        // (totalUSDCPool * weight / totalWeight) / (poolUSDCBalances / totalSupply))
        getNewTokenBalance(_tokens, wc, poolUSDCBalances, newTokenValuesUSDC, totalUSDCPool, totalValueUSDC)
      );
    }

    _updatePoolByPoke(pool, _tokens, newTokenValuesUSDC);
  }

  function getNewTokenBalance(
    address[] memory _tokens,
    uint256[3] memory wc,
    uint256[] memory poolUSDCBalances,
    uint256[] memory newTokenValuesUSDC,
    uint256 totalUSDCPool,
    uint256 totalValueUSDC
  ) internal view returns (uint256) {
    return
      bdiv(
        bdiv(bmul(wc[2], totalUSDCPool), totalWeight),
        bdiv(poolUSDCBalances[wc[0]], IERC20(_tokens[wc[0]]).totalSupply())
      ) * 1e12;
  }

  function getRebindConfigBalances(PowerIndexPoolInterface _pool, address[] memory _tokens)
    internal
    view
    returns (
      uint256[] memory oldBalances,
      uint256[] memory poolUSDCBalances,
      uint256 totalUSDCPool
    )
  {
    uint256 len = _tokens.length;
    oldBalances = new uint256[](len);
    poolUSDCBalances = new uint256[](len);
    totalUSDCPool = USDC.balanceOf(address(this));

    for (uint256 oi = 0; oi < len; oi++) {
      try IERC20(_tokens[oi]).balanceOf(address(_pool)) returns (uint256 _balance) {
        oldBalances[oi] = _balance;
        totalUSDCPool = totalUSDCPool.add(
          getVaultUsdcEstimation(_tokens[oi], IYearnVaultV2(_tokens[oi]).token(), oldBalances[oi])
        );
      } catch {
        oldBalances[oi] = 0;
      }
      uint256 poolUSDCBalance = getVaultVirtualPriceEstimation(_tokens[oi], IYearnVaultV2(_tokens[oi]).totalAssets());
      poolUSDCBalances[oi] = poolUSDCBalance;
    }
  }

  function _addUSDC2CurvePool(address _crvToken, VaultConfig memory _vc, uint256 _usdcAmount) internal {
    if (_vc.depositorTokenLength == 2) {
      uint256[2] memory amounts;
      amounts[uint256(_vc.usdcIndex)] = _usdcAmount;
      if (_vc.depositorType == 2) {
        ICurveZapDepositor2(_vc.depositor).add_liquidity(_crvToken, amounts, 1);
      } else {
        ICurveDepositor2(_vc.depositor).add_liquidity(amounts, 1);
      }
    }

    if (_vc.depositorTokenLength == 3) {
      uint256[3] memory amounts;
      amounts[uint256(_vc.usdcIndex)] = _usdcAmount;
      if (_vc.depositorType == 2) {
        ICurveZapDepositor3(_vc.depositor).add_liquidity(_crvToken, amounts, 1);
      } else {
        ICurveDepositor3(_vc.depositor).add_liquidity(amounts, 1);
      }
    }

    if (_vc.depositorTokenLength == 4) {
      uint256[4] memory amounts;
      amounts[uint256(_vc.usdcIndex)] = _usdcAmount;
      if (_vc.depositorType == 2) {
        ICurveZapDepositor4(_vc.depositor).add_liquidity(_crvToken, amounts, 1);
      } else {
        ICurveDepositor4(_vc.depositor).add_liquidity(amounts, 1);
      }
    }
  }

  function _reward(
    uint256 _reporterId,
    uint256 _gasStart,
    uint256 _compensationPlan,
    bytes calldata _rewardOpts
  ) internal {
    powerPoke.reward(_reporterId, bsub(_gasStart, gasleft()), _compensationPlan, _rewardOpts);
  }

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    (uint256 minInterval, uint256 maxInterval) = powerPoke.getMinMaxReportIntervals(address(this));
    require(minInterval > 0 && maxInterval > 0, "INTERVALS_ARE_0");
    return (minInterval, maxInterval);
  }
}
