// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/aave/IAaveProtoGovernance.sol";
import "../interfaces/aave/IStakedAave.sol";
import "./PowerIndexBasicRouter.sol";
import "hardhat/console.sol";

contract AavePowerIndexRouter is PowerIndexBasicRouter {
  enum CoolDownStatus { NONE, COOLDOWN, UNSTAKE_WINDOW }

  constructor(address _wrappedToken, address _poolRestrictions) public PowerIndexBasicRouter(_wrappedToken, _poolRestrictions) {}

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

    (ReserveStatus reserveStatus, uint256 diff, uint256 reserveAmount) =
      _getReserveStatus(IERC20(staking).balanceOf(wrappedToken_), _withdrawAmount);

    console.log("withdraw     ", _withdrawAmount);
    console.log("status       ", uint256(reserveStatus));
    console.log("diff         ", diff);
    console.log("reserveAmount", reserveAmount);
    console.log("staked       ", IERC20(staking).balanceOf(wrappedToken_));

    // TOOD: revert if _withdrawAmount > reserveAmjunt
    if (reserveStatus == ReserveStatus.ABOVE) {
      CoolDownStatus coolDownStatus = getCoolDownStatus();
      if (coolDownStatus == CoolDownStatus.NONE) {
        _triggerCoolDown();
      } else if (coolDownStatus == CoolDownStatus.COOLDOWN) {
        _redeem(diff);
      }

      // else do nothing
    } else if (reserveStatus == ReserveStatus.BELLOW) {
      _stake(diff);
    }
  }

  function getCoolDownStatus() public view returns (CoolDownStatus) {
    IStakedAave _staking = IStakedAave(staking);
    uint256 stakerCoolDown = _staking.stakersCooldowns(address(this));
    uint256 coolDownSeconds = _staking.COOLDOWN_SECONDS();
    uint256 unstakeWindow = _staking.UNSTAKE_WINDOW();
    uint256 current = block.timestamp;

    if (stakerCoolDown == 0) {
      return CoolDownStatus.NONE;
    }

    uint256 coolDownFinishesAt = stakerCoolDown.add(coolDownSeconds);

    if (current <= coolDownFinishesAt) {
      return CoolDownStatus.COOLDOWN;
    }

    uint256 unstakeFinishesAt = coolDownFinishesAt.add(unstakeWindow);

    // current > coolDownFinishesAt && ...
    if (current < unstakeWindow) {
      return (CoolDownStatus.UNSTAKE_WINDOW);
    }

    return CoolDownStatus.NONE;
  }

  /*** INTERNALS ***/

  function _triggerCoolDown() internal {
    _callStaking(IStakedAave(0).cooldown.selector, "");
  }

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");
    wrappedToken.approveToken(staking, _amount);
    _callStaking(IStakedAave(0).stake.selector, abi.encode(wrappedToken, _amount));
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_REDEEM_0");
    _callStaking(IStakedAave(0).redeem.selector, abi.encode(_amount));
  }
}
