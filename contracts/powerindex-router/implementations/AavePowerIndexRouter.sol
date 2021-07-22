// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/aave/IAaveGovernanceV2.sol";
import "../../interfaces/aave/IStakedAave.sol";
import "../PowerIndexBasicRouter.sol";

contract AavePowerIndexRouter is PowerIndexBasicRouter {
  event TriggerCooldown();
  event Stake(address indexed sender, uint256 amount);
  event Redeem(address indexed sender, uint256 amount);
  event IgnoreDueMissingStaking();
  event ClaimRewards(address indexed sender, uint256 aaveReward);
  event DistributeRewards(
    address indexed sender,
    uint256 aaveReward,
    uint256 pvpReward,
    uint256 poolRewardsUnderlying,
    uint256 poolRewardsPi,
    address[] pools
  );

  enum CoolDownStatus { NONE, COOLDOWN, UNSTAKE_WINDOW }

  struct AaveConfig {
    address AAVE;
  }

  IERC20 internal immutable AAVE;

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    AaveConfig memory _aaveConfig
  ) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    AAVE = IERC20(_aaveConfig.AAVE);
    if (_basicConfig.staking != address(0)) {
      require(
        _basicConfig.claimRewardsInterval < IStakedAave(_basicConfig.staking).UNSTAKE_WINDOW(),
        "REBALANCING_GT_UNSTAKE"
      );
    }
  }

  /*** THE PROXIED METHOD EXECUTORS FOR VOTING ***/

  function callCreate(bytes calldata _args) external {
    _checkVotingSenderAllowed();
    _callVoting(IAaveGovernanceV2(0).create.selector, _args);
  }

  function callSubmitVote(uint256 _proposalId, bool _support) external {
    _checkVotingSenderAllowed();
    _callVoting(IAaveGovernanceV2(0).submitVote.selector, abi.encode(_proposalId, _support));
  }

  function _claimRewards(ReserveStatus) internal override {
    uint256 rewardsPending = IStakedAave(staking).getTotalRewardsBalance(address(piToken));
    require(rewardsPending > 0, "NOTHING_TO_CLAIM");

    _callStaking(IStakedAave.claimRewards.selector, abi.encode(address(this), rewardsPending));

    emit ClaimRewards(msg.sender, rewardsPending);
  }

  function _distributeRewards() internal override {
    uint256 pendingReward = AAVE.balanceOf(address(this));
    require(pendingReward > 0, "NO_PENDING_REWARD");

    // Step #1. Distribute pvpReward
    (uint256 pvpReward, uint256 poolRewardsUnderlying) = _distributeRewardToPvp(pendingReward, AAVE);
    require(poolRewardsUnderlying > 0, "NO_POOL_REWARDS_UNDERLYING");

    // Step #2. Wrap AAVE into piAAVE
    AAVE.approve(address(piToken), poolRewardsUnderlying);
    piToken.deposit(poolRewardsUnderlying);

    // Step #3. Distribute piAAVE over the pools
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

  function triggerCooldown() external onlyOwner {
    _triggerCoolDown();
  }

  /*** POKE FUNCTION ***/

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 diff) internal override {
    require(staking != address(0), "STACKING_IS_NULL");

    if (reserveStatus == ReserveStatus.SHORTAGE) {
      (CoolDownStatus coolDownStatus, uint256 coolDownFinishesAt, uint256 unstakeFinishesAt) = getCoolDownStatus();
      require(coolDownStatus != CoolDownStatus.COOLDOWN, "COOLDOWN");
      if (coolDownStatus == CoolDownStatus.NONE) {
        _triggerCoolDown();
      } else if (coolDownStatus == CoolDownStatus.UNSTAKE_WINDOW) {
        _redeem(diff);
      }
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  function getCoolDownStatus()
    public
    view
    returns (
      CoolDownStatus status,
      uint256 coolDownFinishesAt,
      uint256 unstakeFinishesAt
    )
  {
    IStakedAave staking_ = IStakedAave(staking);
    uint256 stakerCoolDown = staking_.stakersCooldowns(address(piToken));
    uint256 now_ = block.timestamp;

    if (stakerCoolDown == 0) {
      return (CoolDownStatus.NONE, 0, 0);
    }

    uint256 coolDownSeconds = staking_.COOLDOWN_SECONDS();
    uint256 unstakeWindow = staking_.UNSTAKE_WINDOW();

    coolDownFinishesAt = stakerCoolDown.add(coolDownSeconds);
    unstakeFinishesAt = coolDownFinishesAt.add(unstakeWindow);

    if (now_ <= coolDownFinishesAt) {
      status = CoolDownStatus.COOLDOWN;
      // current > coolDownFinishesAt && ...
    } else if (now_ < unstakeFinishesAt) {
      status = CoolDownStatus.UNSTAKE_WINDOW;
    } // else { status = CoolDownStatus.NONE; }
  }

  /*** INTERNALS ***/

  function _getUnderlyingStaked() internal view override returns (uint256) {
    return IERC20(staking).balanceOf(address(piToken));
  }

  function _triggerCoolDown() internal {
    _callStaking(IStakedAave(0).cooldown.selector, "");
    emit TriggerCooldown();
  }

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    piToken.approveUnderlying(staking, _amount);
    _callStaking(IStakedAave(0).stake.selector, abi.encode(piToken, _amount));

    emit Stake(msg.sender, _amount);
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_REDEEM_0");

    _callStaking(IStakedAave(0).redeem.selector, abi.encode(address(piToken), _amount));

    emit Redeem(msg.sender, _amount);
  }
}
