// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../interfaces/WrappedPiErc20Interface.sol";
import "../../interfaces/YearnGovernanceInterface.sol";
import "./../PowerIndexBasicRouter.sol";

contract YearnPowerIndexRouter is PowerIndexBasicRouter {
  event Stake(uint256 amount);
  event Redeem(uint256 amount);
  event IgnoreRedeemDueVoteLock(uint256 voteLockUntilBlock);

  constructor(address _piToken, address _poolRestrictions) public PowerIndexBasicRouter(_piToken, _poolRestrictions) {}

  /*** THE PROXIED METHOD EXECUTORS ***/

  function callRegister() external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).register.selector, "");
  }

  function callExit() external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).exit.selector, "");
  }

  function callPropose(address _executor, string calldata _hash) external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).propose.selector, abi.encode(_executor, _hash));
  }

  function callVoteFor(uint256 _id) external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).voteFor.selector, abi.encode(_id));
  }

  function callVoteAgainst(uint256 _id) external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).voteAgainst.selector, abi.encode(_id));
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
    address piToken_ = msg.sender;

    // Ignore the tokens without a voting assigned
    if (voting == address(0)) {
      return;
    }

    YearnGovernanceInterface _voting = YearnGovernanceInterface(voting);
    (ReserveStatus status, uint256 diff, ) = _getReserveStatus(_voting.balanceOf(piToken_), _withdrawAmount);

    if (status == ReserveStatus.SHORTAGE) {
      uint256 voteLockUntilBlock = _voting.voteLock(piToken_);
      if (voteLockUntilBlock < block.number) {
        _redeem(diff);
      } else {
        emit IgnoreRedeemDueVoteLock(voteLockUntilBlock);
      }
    } else if (status == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  /*** INTERNALS ***/

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    piToken.approveUnderlying(voting, _amount);
    _callVoting(YearnGovernanceInterface(0).stake.selector, abi.encode(_amount));

    emit Stake(_amount);
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_WITHDRAW_0");

    _callVoting(YearnGovernanceInterface(0).withdraw.selector, abi.encode(_amount));

    emit Redeem(_amount);
  }
}
