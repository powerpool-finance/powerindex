// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../interfaces/WrappedPiErc20Interface.sol";
import "../../interfaces/aave/IAaveProtoGovernance.sol";
import "../../interfaces/aave/IStakedAave.sol";
import "../PowerIndexBasicRouter.sol";
import "hardhat/console.sol";

contract AavePowerIndexRouter is PowerIndexBasicRouter {
  event TriggerCooldown();
  event Stake(uint256 amount);
  event Redeem(uint256 amount);
  event IgnoreRedeemDueCoolDown(uint256 coolDownFinishesAt, uint256 unstakeFinishesAt);

  enum CoolDownStatus { NONE, COOLDOWN, UNSTAKE_WINDOW }

  constructor(address _wrappedToken, address _poolRestrictions)
    public
    PowerIndexBasicRouter(_wrappedToken, _poolRestrictions)
  {}

  /*** THE PROXIED METHOD EXECUTORS ***/

  function executeSubmitVote(
    uint256 _id,
    uint256 _vote,
    address _asset
  ) external {
    _checkVotingSenderAllowed();
    _callVoting(IAaveProtoGovernance(0).submitVoteByVoter.selector, abi.encode(_id, _vote, _asset));
  }

  function executeCancelVote(uint256 _id) external {
    _checkVotingSenderAllowed();
    _callVoting(IAaveProtoGovernance(0).cancelVoteByVoter.selector, abi.encode(_id));
  }

  /*** OWNER METHODS ***/

  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  function redeem(uint256 _amount) external onlyOwner {
    _redeem(_amount);
  }

  /*** WRAPPED TOKEN CALLBACK ***/

  function wrapperCallback(uint256 _withdrawAmount) external override {
    address wrappedToken_ = msg.sender;

    // Ignore the tokens without a voting assigned
    if (voting == address(0)) {
      return;
    }

    (ReserveStatus reserveStatus, uint256 diff, ) =
      _getReserveStatus(IERC20(staking).balanceOf(wrappedToken_), _withdrawAmount);

    // TODO: eager revert if _withdrawAmount > reserveAmount
    if (reserveStatus == ReserveStatus.ABOVE) {
      (CoolDownStatus coolDownStatus, uint256 coolDownFinishesAt, uint256 unstakeFinishesAt) = getCoolDownStatus();
      if (coolDownStatus == CoolDownStatus.NONE) {
        _triggerCoolDown();
      } else if (coolDownStatus == CoolDownStatus.UNSTAKE_WINDOW) {
        _redeem(diff);
      }
      /* if (coolDownStatus == CoolDownStatus.COOLDOWN) */
      else {
        emit IgnoreRedeemDueCoolDown(coolDownFinishesAt, unstakeFinishesAt);
      }
    } else if (reserveStatus == ReserveStatus.BELOW) {
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
    IStakedAave _staking = IStakedAave(staking);
    uint256 stakerCoolDown = _staking.stakersCooldowns(address(wrappedToken));
    uint256 coolDownSeconds = _staking.COOLDOWN_SECONDS();
    uint256 unstakeWindow = _staking.UNSTAKE_WINDOW();
    uint256 current = block.timestamp;

    if (stakerCoolDown == 0) {
      return (CoolDownStatus.NONE, 0, 0);
    }

    coolDownFinishesAt = stakerCoolDown.add(coolDownSeconds);
    unstakeFinishesAt = coolDownFinishesAt.add(unstakeWindow);

    if (current <= coolDownFinishesAt) {
      status = CoolDownStatus.COOLDOWN;
      // current > coolDownFinishesAt && ...
    } else if (current < unstakeFinishesAt) {
      status = CoolDownStatus.UNSTAKE_WINDOW;
    } // else { status = CoolDownStatus.NONE; }
  }

  /*** INTERNALS ***/

  function _triggerCoolDown() internal {
    _callStaking(IStakedAave(0).cooldown.selector, "");
    emit TriggerCooldown();
  }

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");
    wrappedToken.approveUnderlying(staking, _amount);

    _callStaking(IStakedAave(0).stake.selector, abi.encode(wrappedToken, _amount));

    emit Stake(_amount);
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_REDEEM_0");

    _callStaking(IERC20(0).approve.selector, abi.encode(staking, _amount));
    _callStaking(IStakedAave(0).redeem.selector, abi.encode(address(wrappedToken), _amount));

    emit Redeem(_amount);
  }
}
