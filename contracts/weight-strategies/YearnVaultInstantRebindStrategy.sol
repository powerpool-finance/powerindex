// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@powerpool/poweroracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interfaces/IVault.sol";
import "../interfaces/PowerIndexPoolControllerInterface.sol";
import "../interfaces/ICurveDepositor.sol";
import "../interfaces/ICurveDepositor2.sol";
import "../interfaces/ICurveDepositor3.sol";
import "../interfaces/ICurveDepositor4.sol";
import "../interfaces/ICurvePoolRegistry.sol";
import "./WeightValueAbstract.sol";
import "./blocks/YearnFeeRefund.sol";
import "./blocks/SinglePoolManagement.sol";

contract YearnVaultInstantRebindStrategy is SinglePoolManagement, YearnFeeRefund, WeightValueAbstract {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;

  event InstantRebind(uint256 poolCurrentTokensCount, uint256 usdcPulled, uint256 usdcRemainder);
  event UpdatePool(address[] poolTokensBefore, address[] poolTokensAfter);
  event VaultWithdrawFee(address indexed vaultToken, uint256 crvAmount);
  event SeizeERC20(address indexed token, address indexed to, uint256 amount);

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

  event SetVaultConfig(address indexed vault, address indexed depositor, uint8 depositorTokenLength, int8 usdcIndex);

  event SetStrategyConstraints(uint256 minUSDCRemainder, bool useVirtualPriceEstimation);

  struct RebindConfig {
    address token;
    uint256 newWeight;
    uint256 oldBalance;
    uint256 newBalance;
  }

  struct VaultConfig {
    address depositor;
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
    StrategyConstraints memory _constraints
  ) external initializer {
    __Ownable_init();

    __SinglePoolManagement_init(_poolController);

    powerPoke = IPowerPoke(_powerPoke);
    curvePoolRegistry = ICurvePoolRegistry(_curvePoolRegistry);
    constraints = _constraints;
    totalWeight = 25 * BONE;
  }

  /*** GETTERS ***/
  function getTokenValue(PowerIndexPoolInterface, address _token) public view override returns (uint256) {
    return getVaultVirtualPriceEstimation(_token, IVault(_token).balance());
  }

  function getVaultVirtualPriceEstimation(address _token, uint256 _amount) public view returns (uint256) {
    return
      ICurvePoolRegistry(curvePoolRegistry).get_virtual_price_from_lp_token(IVault(_token).token()).mul(_amount) / 1e18;
  }

  function getVaultUsdcEstimation(address _token, uint256 _amount) public view returns (uint256) {
    VaultConfig memory vc = vaultConfig[_token];
    return ICurveDepositor(vc.depositor).calc_withdraw_one_coin(_amount, int128(vc.usdcIndex));
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
    uint8 _depositorTokenLength,
    int8 _usdcIndex
  ) external onlyOwner {
    vaultConfig[_vault] = VaultConfig(_depositor, _depositorTokenLength, _usdcIndex);
    IERC20 crvToken = IERC20(IVault(_vault).token());
    USDC.approve(_depositor, uint256(-1));
    crvToken.approve(_vault, uint256(-1));
    crvToken.approve(_depositor, uint256(-1));
    emit SetVaultConfig(_vault, _depositor, _depositorTokenLength, _usdcIndex);
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

  function removeApprovals(IERC20[] calldata _tokens, address[] calldata _tos) external onlyOwner {
    uint256 len = _tokens.length;

    for (uint256 i = 0; i < len; i++) {
      _tokens[i].approve(_tos[i], uint256(0));
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
        IERC20 vaultToken = IERC20(poolTokensBefore[i]);
        vaultToken.approve(pool, uint256(0));
        vaultToken.approve(address(_oldController), uint256(0));
      }
    }

    address[] memory poolTokensAfter = PowerIndexPoolInterface(pool).getCurrentTokens();
    poolTokens = poolTokensAfter;

    // approve
    len = poolTokensAfter.length;
    for (uint256 i = 0; i < len; i++) {
      IERC20 vaultToken = IERC20(poolTokensAfter[i]);
      vaultToken.approve(pool, uint256(-1));
      vaultToken.approve(address(_newController), uint256(-1));
    }

    emit UpdatePool(poolTokensBefore, poolTokensAfter);
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

    _instantRebind();
  }

  function _instantRebind() internal {
    address poolController_ = poolController;
    require(poolController_ != address(0), "CFG_NOT_SET");

    RebindConfig[] memory configs =
      getRebindConfigs(PowerIndexPoolInterface(pool), BPoolInterface(pool).getCurrentTokens());

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
        mem.crvToken = IVault(cfg.token).token();
        mem.vaultReserve = IERC20(mem.crvToken).balanceOf(cfg.token);

        mem.yDiff = (cfg.oldBalance - cfg.newBalance);

        // 1st step. Rebind
        PowerIndexPoolControllerInterface(poolController_).rebindByStrategyRemove(
          cfg.token,
          cfg.newBalance,
          cfg.newWeight
        );
        mem.ycrvBalance = IERC20(cfg.token).balanceOf(address(this));

        // 2nd step. Vault.withdraw()
        mem.crvExpected = (mem.ycrvBalance * IVault(cfg.token).getPricePerFullShare()) / 1e18;
        uint256 crvBefore = IERC20(mem.crvToken).balanceOf(address(this));
        IVault(cfg.token).withdraw(mem.ycrvBalance);
        mem.crvActual = IERC20(mem.crvToken).balanceOf(address(this)).sub(crvBefore);

        // 3rd step. CurvePool.remove_liquidity_one_coin()
        mem.usdcBefore = USDC.balanceOf(address(this));
        ICurveDepositor(vc.depositor).remove_liquidity_one_coin(mem.crvActual, vc.usdcIndex, 0);

        // Increase fee accumulator
        if (mem.crvExpected > mem.crvActual) {
          uint256 diff = mem.crvExpected - mem.crvActual;
          _accountFee(cfg.token, diff);
          emit VaultWithdrawFee(cfg.token, diff);
        }

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
        uint256 crvAmount = IVault(cfg.token).getPricePerFullShare().mul(yDiff) / 1e18;
        uint256 usdcIn;

        if (constraints.useVirtualPriceEstimation) {
          uint256 virtualPrice =
            ICurvePoolRegistry(curvePoolRegistry).get_virtual_price_from_lp_token(IVault(cfg.token).token());
          // usdcIn = virtualPrice * crvAmount / 1e18
          usdcIn = bmul(virtualPrice, crvAmount);
        } else {
          usdcIn = ICurveDepositor(vc.depositor).calc_withdraw_one_coin(crvAmount, int128(vc.usdcIndex));
        }

        // toPushUSDCTotal += usdcIn;
        toPushUSDCTotal = toPushUSDCTotal.add(usdcIn);
        toPushUSDC[si] = usdcIn;
      }
    }

    uint256 usdcPulled = USDC.balanceOf(address(this));

    for (uint256 si = 0; si < len; si++) {
      if (toPushUSDC[si] > 0) {
        RebindConfig memory cfg = configs[si];

        // 1st step. Add USDC to Curve pool
        // uint256 usdcAmount = (usdcPulled * toPushUSDC[si]) / toPushUSDCTotal;
        uint256 usdcAmount = (usdcPulled.mul(toPushUSDC[si])) / toPushUSDCTotal;
        _addUSDC2CurvePool(vaultConfigs[si], usdcAmount);

        // 2nd step. Vault.deposit()
        IERC20 crvToken = IERC20(IVault(cfg.token).token());
        uint256 crvBalance = crvToken.balanceOf(address(this));
        IVault(cfg.token).deposit(crvBalance);

        // 3rd step. Rebind
        uint256 vaultBalance = IVault(cfg.token).balanceOf(address(this));

        // uint256 newBalance = IVault(cfg.token).balanceOf(address(this)) + BPoolInterface(_pool).getBalance(cfg.token)
        uint256 newBalance = IVault(cfg.token).balanceOf(address(this)).add(BPoolInterface(pool).getBalance(cfg.token));
        PowerIndexPoolControllerInterface(poolController_).rebindByStrategyAdd(
          cfg.token,
          newBalance,
          cfg.newWeight,
          vaultBalance
        );
        emit PushLiquidity(cfg.token, address(crvToken), vaultBalance, crvBalance, usdcAmount);
      }
    }

    uint256 usdcRemainder = USDC.balanceOf(address(this));
    require(usdcRemainder <= constraints.minUSDCRemainder, "USDC_REMAINDER");

    emit InstantRebind(len, usdcPulled, usdcRemainder);
  }

  function getRebindConfigs(PowerIndexPoolInterface _pool, address[] memory _tokens)
    internal
    view
    returns (RebindConfig[] memory configs)
  {
    uint256 len = _tokens.length;
    uint256[] memory oldBalances = new uint256[](len);
    uint256[] memory poolUSDCBalances = new uint256[](len);
    uint256 totalUSDCPool = 0;

    for (uint256 oi = 0; oi < len; oi++) {
      uint256 balance = IERC20(_tokens[oi]).balanceOf(address(_pool));
      oldBalances[oi] = balance;
      uint256 poolUSDCBalance = getVaultUsdcEstimation(_tokens[oi], balance);
      poolUSDCBalances[oi] = poolUSDCBalance;
      // totalUSDCPool += poolUSDCBalance;
      totalUSDCPool = totalUSDCPool.add(poolUSDCBalance);
    }

    (uint256[3][] memory weightsChange, , uint256[] memory newTokenValuesUSDC, uint256 totalValueUSDC) =
      computeWeightsChange(_pool, _tokens, new address[](0), 0, 100 ether, block.timestamp, block.timestamp + 1);

    configs = new RebindConfig[](len);

    for (uint256 si = 0; si < len; si++) {
      uint256[3] memory wc = weightsChange[si];
      uint256 oi = wc[0];

      configs[si] = RebindConfig(
        _tokens[oi],
        // (totalWeight * newTokenValuesUSDC[oi]) / totalValueUSDC,
        wc[2],
        oldBalances[oi],
        // (totalUSDCPool * newTokenValuesUSDC[oi] / totalValueUSDC) / (poolUSDCBalances[oi] / oldBalances[oi]))
        bdiv(
          bdiv(bmul(totalUSDCPool, newTokenValuesUSDC[oi]), totalValueUSDC),
          bdiv(poolUSDCBalances[oi], oldBalances[oi])
        )
      );
    }
  }

  function _addUSDC2CurvePool(VaultConfig memory vc, uint256 _usdcAmount) internal {
    if (vc.depositorTokenLength == 2) {
      uint256[2] memory amounts;
      amounts[uint256(vc.usdcIndex)] = _usdcAmount;
      ICurveDepositor2(vc.depositor).add_liquidity(amounts, 1);
    }

    if (vc.depositorTokenLength == 3) {
      uint256[3] memory amounts;
      amounts[uint256(vc.usdcIndex)] = _usdcAmount;
      ICurveDepositor3(vc.depositor).add_liquidity(amounts, 1);
    }

    if (vc.depositorTokenLength == 4) {
      uint256[4] memory amounts;
      amounts[uint256(vc.usdcIndex)] = _usdcAmount;
      ICurveDepositor4(vc.depositor).add_liquidity(amounts, 1);
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
