// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/sushi/IMasterChefV1.sol";
import "../PowerIndexBasicRouter.sol";

abstract contract AbstractMasterChefIndexRouter is PowerIndexBasicRouter {
  event Stake(address indexed sender, uint256 amount);
  event Redeem(address indexed sender, uint256 amount);
  event IgnoreDueMissingStaking();
  event ClaimRewards(address indexed sender, uint256 earned);
  event DistributeRewards(
    address indexed sender,
    uint256 tokenReward,
    uint256 pvpReward,
    uint256 poolRewardsUnderlying,
    uint256 poolRewardsPi,
    address[] pools
  );

  IERC20 internal immutable TOKEN;

  constructor(address _token) public {
    TOKEN = IERC20(_token);
  }

  /*** PERMISSIONLESS REWARD CLAIMING AND DISTRIBUTION ***/

  /**
   * @notice Withdraws the extra staked TOKEN as a reward and transfers it to the router
   */
  function _claimRewards() internal override {
    // Step #1. Claim TOKEN reward from MasterChef governance pool
    uint256 piTokenBalanceBefore = TOKEN.balanceOf(address(piToken));
    _rewards();
    uint256 earned = TOKEN.balanceOf(address(piToken)).sub(piTokenBalanceBefore);
    require(earned > 0, "NOTHING_EARNED");

    // Step #2. Transfer yCrv reward to the router
    piToken.callExternal(address(TOKEN), TOKEN.transfer.selector, abi.encode(address(this), earned), 0);

    emit ClaimRewards(msg.sender, earned);
  }

  /**
   * @notice Wraps the router's underlying balance into piTokens and transfers them
   *         to the pools proportionally their token balances
   */
  function _distributeRewards() internal override {
    uint256 pendingReward = TOKEN.balanceOf(address(this));
    require(pendingReward > 0, "NO_PENDING_REWARD");

    // Step #1. Distribute pvpReward
    (uint256 pvpReward, uint256 poolRewardsUnderlying) = _distributeRewardToPvp(pendingReward, TOKEN);
    require(poolRewardsUnderlying > 0, "NO_POOL_REWARDS_UNDERLYING");

    // Step #2. Wrap token into piToken
    TOKEN.approve(address(piToken), poolRewardsUnderlying);
    piToken.deposit(poolRewardsUnderlying);

    // Step #3. Distribute piToken over the pools
    (uint256 poolRewardsPi, address[] memory pools) = _distributePiRemainderToPools(piToken);

    emit DistributeRewards(msg.sender, pendingReward, pvpReward, poolRewardsUnderlying, poolRewardsPi, pools);
  }

  /*** OWNER METHODS ***/

  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  function redeem(uint256 _amount) external onlyOwner {
    _redeem(_amount);
  }

  /*** POKE FUNCTION ***/

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 diff) internal override {
    require(staking != address(0), "STAKING_IS_NULL");

    if (reserveStatus == ReserveStatus.SHORTAGE) {
      _redeem(diff);
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  /*** INTERNALS ***/

  function _rewards() internal virtual;

  function _stake(uint256 _amount) internal virtual;

  function _redeem(uint256 _amount) internal virtual;
}
