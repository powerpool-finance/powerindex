// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@powerpool/power-oracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/IPoolRestrictions.sol";
import "../interfaces/PowerIndexBasicRouterInterface.sol";
import "../interfaces/BPoolInterface.sol";
import "./PowerIndexNaiveRouter.sol";

contract PowerIndexBasicRouter is PowerIndexBasicRouterInterface, PowerIndexNaiveRouter {
  using SafeERC20 for IERC20;

  uint256 public constant HUNDRED_PCT = 1 ether;

  event SetVotingAndStaking(address indexed voting, address indexed staking);
  event SetReserveConfig(uint256 ratio, uint256 claimRewardsInterval);
  event SetRebalancingInterval(uint256 rebalancingInterval);
  event IgnoreRebalancing(uint256 blockTimestamp, uint256 lastRebalancedAt, uint256 rebalancingInterval);
  event RewardPool(address indexed pool, uint256 amount);
  event SetRewardPools(uint256 len, address[] rewardPools);
  event SetPvpFee(uint256 pvpFee);

  enum ReserveStatus { EQUILIBRIUM, SHORTAGE, EXCESS }

  struct BasicConfig {
    address poolRestrictions;
    address powerPoke;
    address voting;
    address staking;
    uint256 reserveRatio;
    uint256 reserveRatioToForceRebalance;
    uint256 claimRewardsInterval;
    address pvp;
    uint256 pvpFee;
    address[] rewardPools;
  }

  WrappedPiErc20Interface public immutable piToken;
  address public immutable pvp;

  IPoolRestrictions public poolRestrictions;
  IPowerPoke public powerPoke;
  address public voting;
  address public staking;
  uint256 public reserveRatio;
  uint256 public claimRewardsInterval;
  uint256 public lastClaimRewardsAt;
  uint256 public lastRebalancedAt;
  uint256 public reserveRatioToForceRebalance;
  // 1 ether == 100%
  uint256 public pvpFee;

  address[] internal rewardPools;

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;

  modifier onlyPiToken() {
    require(msg.sender == address(piToken), "ONLY_PI_TOKEN_ALLOWED");
    _;
  }

  modifier onlyEOA() {
    require(tx.origin == msg.sender, "ONLY_EOA");
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

  constructor(address _piToken, BasicConfig memory _basicConfig) public PowerIndexNaiveRouter() Ownable() {
    require(_piToken != address(0), "INVALID_PI_TOKEN");
    require(_basicConfig.reserveRatio <= HUNDRED_PCT, "RR_GT_HUNDRED_PCT");
    require(_basicConfig.pvpFee < HUNDRED_PCT, "PVP_FEE_GTE_HUNDRED_PCT");
    require(_basicConfig.pvp != address(0), "INVALID_PVP_ADDR");
    require(_basicConfig.poolRestrictions != address(0), "INVALID_POOL_RESTRICTIONS_ADDR");

    piToken = WrappedPiErc20Interface(_piToken);
    poolRestrictions = IPoolRestrictions(_basicConfig.poolRestrictions);
    powerPoke = IPowerPoke(_basicConfig.powerPoke);
    voting = _basicConfig.voting;
    staking = _basicConfig.staking;
    reserveRatio = _basicConfig.reserveRatio;
    reserveRatioToForceRebalance = _basicConfig.reserveRatioToForceRebalance;
    claimRewardsInterval = _basicConfig.claimRewardsInterval;
    pvp = _basicConfig.pvp;
    pvpFee = _basicConfig.pvpFee;
    rewardPools = _basicConfig.rewardPools;
  }

  receive() external payable {}

  /*** OWNER METHODS ***/

  /**
   * @dev Changing the staking address with a positive underlying stake will break `getPiEquivalentForUnderlying`
   *      formula. Consider moving all the reserves to the piToken contract before doing this.
   */
  function setVotingAndStaking(address _voting, address _staking) external override onlyOwner {
    voting = _voting;
    staking = _staking;
    emit SetVotingAndStaking(_voting, _staking);
  }

  function setReserveConfig(uint256 _reserveRatio, uint256 _claimRewardsInterval) public virtual override onlyOwner {
    require(_reserveRatio <= HUNDRED_PCT, "RR_GREATER_THAN_100_PCT");
    reserveRatio = _reserveRatio;
    claimRewardsInterval = _claimRewardsInterval;
    emit SetReserveConfig(_reserveRatio, _claimRewardsInterval);
  }

  function setRewardPools(address[] calldata _rewardPools) external onlyOwner {
    require(_rewardPools.length > 0, "AT_LEAST_ONE_EXPECTED");
    rewardPools = _rewardPools;
    emit SetRewardPools(_rewardPools.length, _rewardPools);
  }

  function setPvpFee(uint256 _pvpFee) external onlyOwner {
    require(_pvpFee < HUNDRED_PCT, "PVP_FEE_OVER_THE_LIMIT");
    pvpFee = _pvpFee;
    emit SetPvpFee(_pvpFee);
  }

  function setPiTokenEthFee(uint256 _ethFee) external onlyOwner {
    require(_ethFee <= 0.1 ether, "ETH_FEE_OVER_THE_LIMIT");
    piToken.setEthFee(_ethFee);
  }

  function withdrawEthFee(address payable _receiver) external onlyOwner {
    piToken.withdrawEthFee(_receiver);
  }

  function migrateToNewRouter(
    address _piToken,
    address payable _newRouter,
    address[] memory _tokens
  ) public override onlyOwner {
    super.migrateToNewRouter(_piToken, _newRouter, _tokens);

    _newRouter.transfer(address(this).balance);

    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      IERC20 t = IERC20(_tokens[i]);
      t.safeTransfer(_newRouter, t.balanceOf(address(this)));
    }
  }

  function pokeFromReporter(
    uint256 _reporterId,
    bool _claimAndDistributeRewards,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) onlyEOA {
    (uint256 minInterval, ) = _getMinMaxReportInterval();
    (ReserveStatus status, uint256 diff, bool forceRebalance) = getReserveStatus(_getUnderlyingStaked(), 0);
    require(forceRebalance || lastRebalancedAt + minInterval < block.timestamp, "MIN_INTERVAL_NOT_REACHED");
    require(status != ReserveStatus.EQUILIBRIUM, "RESERVE_STATUS_EQUILIBRIUM");
    _rebalancePoke(status, diff);
    _postPoke(_claimAndDistributeRewards);
  }

  function pokeFromSlasher(
    uint256 _reporterId,
    bool _claimAndDistributeRewards,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) onlyEOA {
    (, uint256 maxInterval) = _getMinMaxReportInterval();
    (ReserveStatus status, uint256 diff, bool forceRebalance) = getReserveStatus(_getUnderlyingStaked(), 0);
    require(forceRebalance || lastRebalancedAt + maxInterval < block.timestamp, "MAX_INTERVAL_NOT_REACHED");
    require(status != ReserveStatus.EQUILIBRIUM, "RESERVE_STATUS_EQUILIBRIUM");
    _rebalancePoke(status, diff);
    _postPoke(_claimAndDistributeRewards);
  }

  function poke(bool _claimAndDistributeRewards) external onlyEOA {
    (ReserveStatus status, uint256 diff, ) = getReserveStatus(_getUnderlyingStaked(), 0);
    _rebalancePoke(status, diff);
    _postPoke(_claimAndDistributeRewards);
  }

  function _postPoke(bool _claimAndDistributeRewards) internal {
    lastRebalancedAt = block.timestamp;

    if (_claimAndDistributeRewards && lastClaimRewardsAt + claimRewardsInterval < block.timestamp) {
      _claimRewards();
      _distributeRewards();
      lastClaimRewardsAt = block.timestamp;
    }
  }

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 sushiDiff) internal virtual {
    // need to redefine in implementation
  }

  function _claimRewards() internal virtual {
    // need to redefine in implementation
  }

  function _distributeRewards() internal virtual {
    // need to redefine in implementation
  }

  function _callVoting(bytes4 _sig, bytes memory _data) internal {
    piToken.callExternal(voting, _sig, _data, 0);
  }

  function _callStaking(bytes4 _sig, bytes memory _data) internal {
    piToken.callExternal(staking, _sig, _data, 0);
  }

  function _checkVotingSenderAllowed() internal view {
    require(poolRestrictions.isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
  }

  function _distributeRewardToPvp(uint256 _totalReward, IERC20 _underlying)
    internal
    returns (uint256 pvpReward, uint256 remainder)
  {
    pvpReward = 0;
    remainder = 0;

    if (pvpFee > 0) {
      pvpReward = _totalReward.mul(pvpFee).div(HUNDRED_PCT);
      remainder = _totalReward.sub(pvpReward);
      _underlying.safeTransfer(pvp, pvpReward);
    } else {
      remainder = _totalReward;
    }
  }

  function _distributePiRemainderToPools(IERC20 _piToken)
    internal
    returns (uint256 piBalanceToDistribute, address[] memory pools)
  {
    pools = rewardPools;
    uint256 poolsLen = pools.length;
    require(poolsLen > 0, "MISSING_REWARD_POOLS");

    piBalanceToDistribute = piToken.balanceOf(address(this));
    require(piBalanceToDistribute > 0, "NO_POOL_REWARDS_PI");

    uint256 totalPiOnPools = 0;
    for (uint256 i = 0; i < poolsLen; i++) {
      totalPiOnPools = totalPiOnPools.add(_piToken.balanceOf(pools[i]));
    }
    require(totalPiOnPools > 0, "TOTAL_PI_IS_0");

    for (uint256 i = 0; i < poolsLen; i++) {
      address pool = pools[i];
      uint256 poolPiBalance = piToken.balanceOf(pool);
      if (poolPiBalance == 0) {
        continue;
      }

      uint256 poolReward = piBalanceToDistribute.mul(poolPiBalance) / totalPiOnPools;

      piToken.transfer(pool, poolReward);

      BPoolInterface(pool).gulp(address(piToken));
      emit RewardPool(pool, poolReward);
    }
  }

  /*
   * @dev Getting status and diff of actual staked balance and target reserve balance.
   */
  function getReserveStatusForStakedBalance()
    public
    view
    returns (
      ReserveStatus status,
      uint256 diff,
      bool forceRebalance
    )
  {
    return getReserveStatus(_getUnderlyingStaked(), 0);
  }

  /*
   * @dev Getting status and diff of provided staked balance and target reserve balance.
   */
  function getReserveStatus(uint256 _stakedBalance, uint256 _withdrawAmount)
    public
    view
    returns (
      ReserveStatus status,
      uint256 diff,
      bool forceRebalance
    )
  {
    uint256 expectedReserveAmount;
    (status, diff, expectedReserveAmount) = getReserveStatusPure(
      reserveRatio,
      piToken.getUnderlyingBalance(),
      _stakedBalance,
      _withdrawAmount
    );

    if (status == ReserveStatus.SHORTAGE) {
      uint256 currentRatio = expectedReserveAmount.sub(diff).mul(HUNDRED_PCT).div(expectedReserveAmount);
      forceRebalance = reserveRatioToForceRebalance >= currentRatio;
    }
  }

  // NOTICE: could/should be changed depending on implementation
  function _getUnderlyingStaked() internal view virtual returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }
    return IERC20(staking).balanceOf(address(piToken));
  }

  function getUnderlyingStaked() external view returns (uint256) {
    return _getUnderlyingStaked();
  }

  function getRewardPools() external view returns (address[] memory) {
    return rewardPools;
  }

  function getPiEquivalentForUnderlying(
    uint256 _underlyingAmount,
    IERC20 _underlyingToken,
    uint256 _piTotalSupply
  ) public view virtual override returns (uint256) {
    uint256 underlyingOnPiToken = _underlyingToken.balanceOf(address(piToken));
    return
      getPiEquivalentForUnderlyingPure(
        _underlyingAmount,
        // underlyingOnPiToken + underlyingOnStaking,
        underlyingOnPiToken.add(_getUnderlyingStaked()),
        _piTotalSupply
      );
  }

  function getPiEquivalentForUnderlyingPure(
    uint256 _underlyingAmount,
    uint256 _totalUnderlyingWrapped,
    uint256 _piTotalSupply
  ) public pure virtual override returns (uint256) {
    if (_piTotalSupply == 0) {
      return _underlyingAmount;
    }
    // return _piTotalSupply * _underlyingAmount / _totalUnderlyingWrapped;
    return _piTotalSupply.mul(_underlyingAmount).div(_totalUnderlyingWrapped);
  }

  function getUnderlyingEquivalentForPi(
    uint256 _piAmount,
    IERC20 _underlyingToken,
    uint256 _piTotalSupply
  ) public view virtual override returns (uint256) {
    uint256 underlyingOnPiToken = _underlyingToken.balanceOf(address(piToken));
    return
      getUnderlyingEquivalentForPiPure(
        _piAmount,
        // underlyingOnPiToken + underlyingOnStaking,
        underlyingOnPiToken.add(_getUnderlyingStaked()),
        _piTotalSupply
      );
  }

  function getUnderlyingEquivalentForPiPure(
    uint256 _piAmount,
    uint256 _totalUnderlyingWrapped,
    uint256 _piTotalSupply
  ) public pure virtual override returns (uint256) {
    if (_piTotalSupply == 0) {
      return _piAmount;
    }
    // _piAmount * _totalUnderlyingWrapped / _piTotalSupply;
    return _totalUnderlyingWrapped.mul(_piAmount).div(_piTotalSupply);
  }

  /**
   * @notice Calculates the desired reserve status
   * @param _reserveRatioPct The reserve ratio in %, 1 ether == 100 ether
   * @param _leftOnPiToken The amount of origin tokens left on the piToken (WrappedPiErc20) contract
   * @param _stakedBalance The amount of original tokens staked on the staking contract
   * @param _withdrawAmount The amount to be withdrawn within the current transaction
   *                        (could be negative in a case of deposit)
   * @return status The reserve status:
   * * SHORTAGE - There is not enough underlying funds on the wrapper contract to satisfy the reserve ratio,
   *           the diff amount should be redeemed from the staking contract
   * * EXCESS - there are some extra funds over reserve ratio on the wrapper contract,
   *           the diff amount should be sent to the staking contract
   * * EQUILIBRIUM - the reserve ratio hasn't changed,
   *           the diff amount is 0 and there are no additional stake/redeem actions expected
   * @return diff The difference between `adjustedReserveAmount` and `_leftOnWrapper`
   * @return expectedReserveAmount The calculated expected reserve amount
   */
  function getReserveStatusPure(
    uint256 _reserveRatioPct,
    uint256 _leftOnPiToken,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  )
    public
    pure
    returns (
      ReserveStatus status,
      uint256 diff,
      uint256 expectedReserveAmount
    )
  {
    require(_reserveRatioPct <= HUNDRED_PCT, "RR_GREATER_THAN_100_PCT");
    expectedReserveAmount = getExpectedReserveAmount(_reserveRatioPct, _leftOnPiToken, _stakedBalance, _withdrawAmount);

    if (expectedReserveAmount > _leftOnPiToken) {
      status = ReserveStatus.SHORTAGE;
      diff = expectedReserveAmount.sub(_leftOnPiToken);
    } else if (expectedReserveAmount < _leftOnPiToken) {
      status = ReserveStatus.EXCESS;
      diff = _leftOnPiToken.sub(expectedReserveAmount);
    } else {
      status = ReserveStatus.EQUILIBRIUM;
      diff = 0;
    }
  }

  /**
   * @notice Calculates an expected reserve amount after the transaction taking into an account the withdrawAmount
   * @param _reserveRatioPct % of a reserve ratio, 1 ether == 100%
   * @param _leftOnPiToken The amount of origin tokens left on the piToken (WrappedPiErc20) contract
   * @param _stakedBalance The amount of original tokens staked on the staking contract
   * @param _withdrawAmount The amount to be withdrawn within the current transaction
   *                        (could be negative in a case of deposit)
   * @return expectedReserveAmount The expected reserve amount
   *
   *                           / %reserveRatio * (staked + _leftOnPiToken - withdrawAmount) \
   * expectedReserveAmount =  | ------------------------------------------------------------| + withdrawAmount
   *                           \                         100%                              /
   */
  function getExpectedReserveAmount(
    uint256 _reserveRatioPct,
    uint256 _leftOnPiToken,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  ) public pure returns (uint256) {
    return
      _reserveRatioPct.mul(_stakedBalance.add(_leftOnPiToken).sub(_withdrawAmount)).div(HUNDRED_PCT).add(
        _withdrawAmount
      );
  }

  function _reward(
    uint256 _reporterId,
    uint256 _gasStart,
    uint256 _compensationPlan,
    bytes calldata _rewardOpts
  ) internal {
    powerPoke.reward(_reporterId, _gasStart.sub(gasleft()), _compensationPlan, _rewardOpts);
  }

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    return powerPoke.getMinMaxReportIntervals(address(this));
  }
}
