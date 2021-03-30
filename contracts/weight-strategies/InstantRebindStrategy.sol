// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@powerpool/poweroracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interfaces/IVault.sol";
import "../interfaces/ICurveDepositor.sol";
import "../interfaces/ICurveDepositor2.sol";
import "../interfaces/ICurveDepositor3.sol";
import "../interfaces/ICurveDepositor4.sol";
import "../interfaces/ICurvePoolRegistry.sol";
import "./WeightValueAbstract.sol";
import "./blocks/PoolManagement.sol";

contract InstantRebindStrategy is PoolManagement, WeightValueAbstract {
  using SafeMath for uint256;

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;

  event InstantRebind(address indexed pool, uint256 poolCurrentTokensCount, uint256 usdcPulled, uint256 usdcRemainder);

  event PullLiquidity(
    address indexed bpool,
    address indexed vaultToken,
    address crvToken,
    uint256 vaultAmount,
    uint256 crvAmount,
    uint256 usdcAmount
  );

  event PushLiquidity(
    address indexed bpool,
    address indexed vaultToken,
    address crvToken,
    uint256 vaultAmount,
    uint256 crvAmount,
    uint256 usdcAmount
  );

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

  IERC20 public immutable USDC;

  StrategyConstraints public constraints;

  IPowerPoke public powerPoke;
  ICurvePoolRegistry public curvePoolRegistry;

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

  constructor(address _usdc) public OwnableUpgradeSafe() {
    USDC = IERC20(_usdc);
  }

  function initialize(
    address _powerPoke,
    address _curvePoolRegistry,
    address _oracle,
    StrategyConstraints memory _constraints
  ) external initializer {
    __Ownable_init();
    powerPoke = IPowerPoke(_powerPoke);
    oracle = IPowerOracle(_oracle);
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

  /*** OWNER'S SETTERS ***/
  function setPoolRegistry(address _curvePoolRegistry) external onlyOwner {
    curvePoolRegistry = ICurvePoolRegistry(_curvePoolRegistry);
  }

  function setVaultConfig(
    address _vault,
    address _depositor,
    uint8 _depositorTokenLength,
    int8 _usdcIndex
  ) external onlyOwner {
    vaultConfig[_vault] = VaultConfig(_depositor, _depositorTokenLength, _usdcIndex);
  }

  function setPools(address[] memory _pools) external onlyOwner {
    pools = _pools;
  }

  function setStrategyConstraints(StrategyConstraints memory _constraints) external onlyOwner {
    constraints = _constraints;
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
    for (uint256 i = 0; i < pools.length; i++) {
      _handlePool(pools[i]);
    }
  }

  function _handlePool(address _pool) internal {
    RebindConfig[] memory configs =
      getRebindConfigs(PowerIndexPoolInterface(_pool), BPoolInterface(_pool).getCurrentTokens());

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
        uint256 yDiff = (cfg.oldBalance - cfg.newBalance);
        PowerIndexPoolController controller = poolsData[_pool].controller;
        require(address(controller) != address(0), "CFG_NOT_SET");

        // 1st step. Rebind
        controller.rebindByStrategyRemove(cfg.token, cfg.newBalance, cfg.newWeight);
        uint256 ycrvBalance = IERC20(cfg.token).balanceOf(address(this));

        // 2nd step. Vault.withdraw()
        IERC20 crvToken = IERC20(IVault(cfg.token).token());
        IVault(cfg.token).withdraw(ycrvBalance);
        uint256 crvBalance = crvToken.balanceOf(address(this));

        // 3rd step. CurvePool.remove_liquidity_one_coin()
        crvToken.approve(vc.depositor, crvBalance);
        uint256 usdcBefore = USDC.balanceOf(address(this));
        ICurveDepositor(vc.depositor).remove_liquidity_one_coin(crvBalance, vc.usdcIndex, 0);
        emit PullLiquidity(
          _pool,
          cfg.token,
          address(crvToken),
          yDiff,
          crvBalance,
          USDC.balanceOf(address(this)) - usdcBefore
        );
      } else {
        // uint256 yDiff = cfg.newBalance - cfg.oldBalance;
        uint256 yDiff = cfg.newBalance.sub(cfg.oldBalance);
        uint256 crvAmount = IVault(cfg.token).getPricePerFullShare().mul(yDiff) / 1e18;
        uint256 usdcIn;

        if (constraints.useVirtualPriceEstimation) {
          // usdcIn = (ICurvePoolRegistry(curvePoolRegistry).get_virtual_price_from_lp_token(IVault(cfg.token).token()) * crvAmount) / 1e18;
          usdcIn =
            (
              ICurvePoolRegistry(curvePoolRegistry).get_virtual_price_from_lp_token(IVault(cfg.token).token()).mul(
                crvAmount
              )
            ) /
            1e18;
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
        USDC.approve(vaultConfigs[si].depositor, usdcAmount);
        _addUSDC2CurvePool(vaultConfigs[si], usdcAmount);

        // 2nd step. Vault.deposit()
        IERC20 crvToken = IERC20(IVault(cfg.token).token());
        uint256 crvBalance = crvToken.balanceOf(address(this));
        crvToken.approve(cfg.token, crvBalance);
        IVault(cfg.token).deposit(crvBalance);

        // 3rd step. Rebind
        PowerIndexPoolController controller = poolsData[_pool].controller;
        uint256 vaultBalance = IVault(cfg.token).balanceOf(address(this));
        IERC20(cfg.token).approve(address(controller), vaultBalance);

        // uint256 newBalance = IVault(cfg.token).balanceOf(address(this)) + BPoolInterface(_pool).getBalance(cfg.token);
        uint256 newBalance =
          IVault(cfg.token).balanceOf(address(this)).add(BPoolInterface(_pool).getBalance(cfg.token));
        controller.rebindByStrategyAdd(cfg.token, newBalance, cfg.newWeight, vaultBalance);
        emit PushLiquidity(_pool, cfg.token, address(crvToken), vaultBalance, crvBalance, usdcAmount);
      }
    }

    uint256 usdcRemainder = USDC.balanceOf(address(this));
    require(usdcRemainder <= constraints.minUSDCRemainder, "USDC_REMAINDER");

    emit InstantRebind(_pool, len, usdcPulled, usdcRemainder);
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
        (totalWeight.mul(newTokenValuesUSDC[oi])) / totalValueUSDC,
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
}
