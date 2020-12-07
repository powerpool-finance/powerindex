// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../interfaces/WrappedPiErc20Interface.sol";
import "../PowerIndexBasicRouter.sol";
import "../../interfaces/CurveStakeInterface.sol";

contract CurvePowerIndexRouter is PowerIndexBasicRouter {
  event SetMinLockTime(uint256 minLockTime);

  bytes4 public constant CREATE_STAKE_SIG = bytes4(keccak256(bytes("create_lock(uint256,uint256)")));
  bytes4 public constant INCREASE_STAKE_SIG = bytes4(keccak256(bytes("increase_amount(uint256)")));
  bytes4 public constant INCREASE_STAKE_TIME_SIG = bytes4(keccak256(bytes("increase_unlock_time(uint256)")));
  bytes4 public constant WITHDRAW_SIG = bytes4(keccak256(bytes("withdraw()")));

  bytes4 public constant PROPOSE_SIG = bytes4(keccak256(bytes("newVote(bytes,string,bool,bool)")));
  bytes4 public constant VOTE_SIG = bytes4(keccak256(bytes("vote(uint256,bool,bool)")));

  uint256 public constant WEEK = 7 * 86400;

  uint256 public minLockTime;

  constructor(
    address _wrappedToken,
    address _poolRestrictions,
    uint256 _minLockTime
  ) public PowerIndexBasicRouter(_wrappedToken, _poolRestrictions) {
    minLockTime = _minLockTime;
  }

  function setMinLockTime(uint256 _minLockTime) external onlyOwner {
    minLockTime = _minLockTime;
    emit SetMinLockTime(_minLockTime);
  }

  /*** THE PROXIED METHOD EXECUTORS ***/

  function executePropose(
    bytes calldata _executionScript,
    string calldata _metadata,
    bool _castVote,
    bool _executesIfDecided
  ) external {
    _checkVotingSenderAllowed();
    _callVoting(PROPOSE_SIG, abi.encode(_executionScript, _metadata, _castVote, _executesIfDecided));
  }

  function executeVoteFor(uint256 _voteId, bool _executesIfDecided) external {
    _checkVotingSenderAllowed();
    _callVoting(VOTE_SIG, abi.encode(_voteId, true, _executesIfDecided));
  }

  function executeVoteAgainst(uint256 _voteId, bool _executesIfDecided) external {
    _checkVotingSenderAllowed();
    _callVoting(VOTE_SIG, abi.encode(_voteId, false, _executesIfDecided));
  }

  /*** OWNER METHODS ***/

  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  function redeem(address _wrappedToken) external onlyOwner {
    _redeem();
  }

  /*** WRAPPED TOKEN CALLBACK ***/

  function wrapperCallback(uint256 _withdrawAmount) external override {
    address wrappedToken_ = msg.sender;

    // Ignore the tokens without a voting assigned
    if (staking == address(0)) {
      return;
    }

    CurveStakeInterface staking_ = CurveStakeInterface(staking);
    (ReserveStatus status, uint256 diff, uint256 reserveAmount) =
      _getReserveStatus(staking_.balanceOf(wrappedToken_), _withdrawAmount);

    if (status == ReserveStatus.ABOVE) {
      (, uint256 end) = staking_.locked(wrappedToken_);
      if (end < block.timestamp) {
        _redeem();
        _stake(reserveAmount);
      }
    } else if (status == ReserveStatus.BELOW) {
      _stake(diff);
    }
  }

  /*** INTERNALS ***/

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    CurveStakeInterface staking_ = CurveStakeInterface(staking);
    (uint256 lockedAmount, uint256 lockedEnd) = staking_.locked(address(wrappedToken));

    if (lockedEnd != 0 && lockedEnd <= block.timestamp) {
      _redeem();
      lockedEnd = 0;
    }

    wrappedToken.approveUnderlying(staking, _amount);

    if (lockedEnd == 0) {
      _callStaking(CREATE_STAKE_SIG, abi.encode(_amount, block.timestamp + WEEK));
    } else {
      if (block.timestamp + minLockTime > lockedEnd) {
        _callStaking(INCREASE_STAKE_TIME_SIG, abi.encode(block.timestamp + minLockTime));
      }
      if (_amount > lockedAmount) {
        _callStaking(INCREASE_STAKE_SIG, abi.encode(_amount.sub(lockedAmount)));
      }
    }
  }

  function _redeem() internal {
    _callStaking(WITHDRAW_SIG, abi.encode());
  }
}
