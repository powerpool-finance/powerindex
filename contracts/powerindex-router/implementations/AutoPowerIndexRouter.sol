// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/IAutoFarm.sol";
import "../../interfaces/IAutoFarmStrategy.sol";
import "../PowerIndexBasicRouter.sol";

/**
 * Compatible with:
 * - Auto: https://bscscan.com/address/0x763a05bdb9f8946d8c3fa72d1e0d3f5e68647e5c,
 *   pending rewards via stakedWantTokens(pid, user)
 */
contract AutoPowerIndexRouter is PowerIndexBasicRouter {
  event Stake(address indexed sender, uint256 amount);
  event Redeem(address indexed sender, uint256 amount);
  event ClaimRewards(address indexed sender, uint256 expectedAutoReward, uint256 releasedAutoReward);
  event DistributeRewards(
    address indexed sender,
    uint256 autoReward,
    uint256 pvpReward,
    uint256 poolRewardsUnderlying,
    uint256 poolRewardsPi,
    address[] pools
  );

  struct AutoConfig {
    address AUTO;
  }

  uint256 internal constant AUTO_FARM_PID = 0;
  IERC20 internal immutable AUTO;

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    AutoConfig memory _autoConfig
  ) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    AUTO = IERC20(_autoConfig.AUTO);
  }

  /*** PERMISSIONLESS REWARD CLAIMING AND DISTRIBUTION ***/

  /**
   * @notice Withdraws the extra staked AUTO as a reward and transfers it to the router
   */
  function _claimRewards(ReserveStatus) internal override {
    uint256 rewardsPending = getPendingRewards();
    require(rewardsPending > 0, "NOTHING_TO_CLAIM");

    uint256 autoBefore = AUTO.balanceOf(address(piToken));

    // Step #1. Claim the excess of AUTO from AutoFarm
    _callStaking(IAutoFarm.withdraw.selector, abi.encode(AUTO_FARM_PID, rewardsPending));
    uint256 released = AUTO.balanceOf(address(piToken)).sub(autoBefore);
    require(released > 0, "NOTHING_RELEASED");

    // Step #2. Transfer the claimed AUTO to the router
    _safeTransfer(AUTO, address(this), released);

    emit ClaimRewards(msg.sender, rewardsPending, released);
  }

  /**
   * @notice Wraps the router's AUTOs into piTokens and transfers it to the pools proportionally their AUTO balances
   */
  function _distributeRewards() internal override {
    uint256 pendingReward = AUTO.balanceOf(address(this));
    require(pendingReward > 0, "NO_PENDING_REWARD");

    // Step #1. Distribute pvpReward
    (uint256 pvpReward, uint256 poolRewardsUnderlying) = _distributeRewardToPvp(pendingReward, AUTO);
    require(poolRewardsUnderlying > 0, "NO_POOL_REWARDS_UNDERLYING");

    // Step #2. Wrap AUTO into piAUTO
    AUTO.approve(address(piToken), poolRewardsUnderlying);
    piToken.deposit(poolRewardsUnderlying);

    // Step #3. Distribute piAUTO over the pools
    (uint256 poolRewardsPi, address[] memory pools) = _distributePiRemainderToPools(piToken);

    emit DistributeRewards(msg.sender, pendingReward, pvpReward, poolRewardsUnderlying, poolRewardsPi, pools);
  }

  /*** VIEWERS ***/

  /**
   * @notice Get the amount of AUTO tokens AutoFarm will release in exchange of the given shares
   * @param _shares The input amount of shares
   * @dev To be used from front-end only
   * @return The corresponding amount of AUTO tokens
   */
  function getAutoForShares(uint256 _shares) external view returns (uint256) {
    (, , , , address strat) = IAutoFarm(staking).poolInfo(AUTO_FARM_PID);

    uint256 wantLockedTotal = IAutoFarmStrategy(strat).wantLockedTotal();
    uint256 sharesTotal = IAutoFarmStrategy(strat).sharesTotal();

    return _shares.mul(wantLockedTotal).div(sharesTotal);
  }

  /**
   * @notice Get the total amount of AUTO tokens could be released in exchange of the piToken's AutoFarm share.
   *         Is comprised of the underlyingStaked and the pendingRewards.
   * @return The AUTO amount
   */
  function getUnderlyingOnAutoFarm() public view returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }

    return IAutoFarm(staking).stakedWantTokens(AUTO_FARM_PID, address(piToken));
  }

  /**
   * @notice Get the amount of current pending rewards available at AutoFarm
   * @return amount of pending rewards
   */
  function getPendingRewards() public view returns (uint256 amount) {
    // return autoAtPiToken + getUnderlyingOnAutoFarm - piToken.totalSupply()
    return AUTO.balanceOf(address(piToken)).add(getUnderlyingOnAutoFarm()).sub(piToken.totalSupply());
  }

  /*** EQUIVALENT METHODS OVERRIDES ***/

  function getPiEquivalentForUnderlying(
    uint256 _underlyingAmount,
    IERC20, /* _underlyingToken */
    uint256 /* _piTotalSupply */
  ) external view override returns (uint256) {
    return _underlyingAmount;
  }

  function getPiEquivalentForUnderlyingPure(
    uint256 _underlyingAmount,
    uint256, /* _totalUnderlyingWrapped */
    uint256 /* _piTotalSupply */
  ) public pure override returns (uint256) {
    return _underlyingAmount;
  }

  function getUnderlyingEquivalentForPi(
    uint256 _piAmount,
    IERC20, /* _underlyingToken */
    uint256 /* _piTotalSupply */
  ) external view override returns (uint256) {
    return _piAmount;
  }

  function getUnderlyingEquivalentForPiPure(
    uint256 _piAmount,
    uint256, /* _totalUnderlyingWrapped */
    uint256 /* _piTotalSupply */
  ) public pure override returns (uint256) {
    return _piAmount;
  }

  /*** OWNER METHODS ***/

  /**
   * @notice The contract owner manually stakes the given amount of AUTO
   * @param _amount The amount AUTO to stake
   */
  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  /**
   * @notice The contract owner manually burns the given amount of staking shares in exchange of AUTO tokens
   * @param _amount The amount auto to redeem
   */
  function redeem(uint256 _amount) external onlyOwner {
    _redeem(_amount);
  }

  /*** POKE FUNCTION ***/

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 autoDiff) internal override {
    require(staking != address(0), "STAKING_IS_NULL");

    if (reserveStatus == ReserveStatus.SHORTAGE) {
      _redeem(autoDiff);
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(autoDiff);
    }
  }

  /*** INTERNALS ***/

  /**
   * @notice Get the opposite to the reserve ratio amount of AUTO staked at AutoFarm
   * @return The AUTO amount
   */
  function _getUnderlyingStaked() internal view override returns (uint256) {
    // return piTokenTotalSupply - autoAtPiToken
    return piToken.totalSupply().sub(AUTO.balanceOf(address(piToken)));
  }

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    piToken.approveUnderlying(staking, _amount);
    _callStaking(IAutoFarm(0).deposit.selector, abi.encode(AUTO_FARM_PID, _amount));

    emit Stake(msg.sender, _amount);
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_REDEEM_0");

    _callStaking(IAutoFarm(0).withdraw.selector, abi.encode(AUTO_FARM_PID, _amount));

    emit Redeem(msg.sender, _amount);
  }
}
