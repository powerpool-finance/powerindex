// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/WrappedPiErc20Interface.sol";
import "./PowerIndexSimpleRouter.sol";
import "../interfaces/CurveStakeInterface.sol";

contract CurvePowerIndexRouter is PowerIndexSimpleRouter {
  event SetMinLockTime(uint256 minLockTime);

  bytes4 public constant CREATE_STAKE_SIG = bytes4(keccak256(bytes("create_lock(uint256,uint256)")));
  bytes4 public constant INCREASE_STAKE_SIG = bytes4(keccak256(bytes("increase_amount(uint256)")));
  bytes4 public constant INCREASE_STAKE_TIME_SIG = bytes4(keccak256(bytes("increase_unlock_time(uint256)")));
  bytes4 public constant WITHDRAW_SIG = bytes4(keccak256(bytes("withdraw()")));

  bytes4 public constant PROPOSE_SIG = bytes4(keccak256(bytes("newVote(bytes,string,bool,bool)")));
  bytes4 public constant VOTE_SIG = bytes4(keccak256(bytes("vote(uint256,bool,bool)")));

  uint256 public constant WEEK = 7 * 86400;

  uint256 public minLockTime;

  constructor(address _poolRestrictions, uint256 _minLockTime) public PowerIndexSimpleRouter(_poolRestrictions) {
    minLockTime = _minLockTime;
  }

  function setMinLockTime(uint256 _minLockTime) external onlyOwner {
    minLockTime = _minLockTime;
    emit SetMinLockTime(_minLockTime);
  }

  /*** THE PROXIED METHOD EXECUTORS ***/

  function executePropose(
    address _wrappedToken,
    bytes calldata _executionScript,
    string calldata _metadata,
    bool _castVote,
    bool _executesIfDecided
  ) external {
    _checkVotingSenderAllowed(_wrappedToken);
    _callVoting(_wrappedToken, PROPOSE_SIG, abi.encode(_executionScript, _metadata, _castVote, _executesIfDecided));
  }

  function executeVoteFor(
    address _wrappedToken,
    uint256 _voteId,
    bool _executesIfDecided
  ) external {
    _checkVotingSenderAllowed(_wrappedToken);
    _callVoting(_wrappedToken, VOTE_SIG, abi.encode(_voteId, true, _executesIfDecided));
  }

  function executeVoteAgainst(
    address _wrappedToken,
    uint256 _voteId,
    bool _executesIfDecided
  ) external {
    _checkVotingSenderAllowed(_wrappedToken);
    _callVoting(_wrappedToken, VOTE_SIG, abi.encode(_voteId, false, _executesIfDecided));
  }

  /*** OWNER METHODS ***/

  function stakeWrappedToVoting(address _wrappedToken, uint256 _amount) external onlyOwner {
    _stakeWrappedToVoting(_wrappedToken, _amount);
  }

  function withdrawWrappedFromVoting(address _wrappedToken) external onlyOwner {
    _withdrawWrappedFromVoting(_wrappedToken);
  }

  /*** WRAPPED TOKEN CALLBACK ***/

  function wrapperCallback(uint256 _withdrawAmount) external override {
    address wrappedToken = msg.sender;
    address stakingAddress = stakingByWrapped[wrappedToken];

    // Ignore the tokens without a voting assigned
    if (stakingAddress == address(0)) {
      return;
    }

    CurveStakeInterface staking = CurveStakeInterface(stakingAddress);
    (ReserveStatus status, uint256 diff, uint256 reserveAmount) =
      _getReserveStatus(wrappedToken, staking.balanceOf(wrappedToken), _withdrawAmount);

    if (status == ReserveStatus.ABOVE) {
      (, uint256 end) = staking.locked(wrappedToken);
      if (end < block.timestamp) {
        _withdrawWrappedFromVoting(wrappedToken);
        _stakeWrappedToVoting(msg.sender, reserveAmount);
      }
    } else if (status == ReserveStatus.BELLOW) {
      _stakeWrappedToVoting(msg.sender, diff);
    }
  }

  /*** INTERNALS ***/

  function _stakeWrappedToVoting(address _wrappedToken, uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    CurveStakeInterface staking = CurveStakeInterface(stakingByWrapped[_wrappedToken]);
    (uint256 lockedAmount, uint256 lockedEnd) = staking.locked(_wrappedToken);

    if (lockedEnd != 0 && lockedEnd <= block.timestamp) {
      _withdrawWrappedFromVoting(_wrappedToken);
      lockedEnd = 0;
    }

    _approveWrappedTokenToStaking(_wrappedToken, _amount);

    if (lockedEnd == 0) {
      _callStaking(_wrappedToken, CREATE_STAKE_SIG, abi.encode(_amount, block.timestamp + WEEK));
    } else {
      if (block.timestamp + minLockTime > lockedEnd) {
        _callStaking(_wrappedToken, INCREASE_STAKE_TIME_SIG, abi.encode(block.timestamp + minLockTime));
      }
      if (_amount > lockedAmount) {
        _callStaking(_wrappedToken, INCREASE_STAKE_SIG, abi.encode(_amount.sub(lockedAmount)));
      }
    }
  }

  function _withdrawWrappedFromVoting(address _wrappedToken) internal {
    _callStaking(_wrappedToken, WITHDRAW_SIG, abi.encode());
  }
}
