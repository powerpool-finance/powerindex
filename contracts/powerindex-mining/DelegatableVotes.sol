// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../lib/DelegatableCheckpoints.sol";
import "../lib/SafeMath96.sol";

abstract contract DelegatableVotes {
  using SafeMath96 for uint96;
  using DelegatableCheckpoints for DelegatableCheckpoints.Record;

  /**
   * @notice Votes computation data for each account
   * @dev Data adjusted to account "delegated" votes
   * @dev For the contract address, stores shared for all accounts data
   */
  mapping(address => DelegatableCheckpoints.Record) public book;

  /**
   * @dev Data on votes which an account may delegate or has already delegated
   */
  mapping(address => uint192) internal delegatables;

  /// @notice The event is emitted when a delegate account' vote balance changes
  event CheckpointBalanceChanged(address indexed delegate, uint256 previousBalance, uint256 newBalance);

  /// @notice An event that's emitted when an account changes its delegate
  event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);

  /**
   * @notice Get the "delegatee" account for the message sender
   */
  function delegatee() public view returns (address) {
    return book[msg.sender].delegatee;
  }

  /**
   * @notice Delegate votes from `msg.sender` to `delegatee`
   * @param delegatee_ The address to delegate votes to
   */
  function delegate(address delegatee_) public {
    require(delegatee_ != address(this), "delegate: can't delegate to the contract address");
    return _delegate(msg.sender, delegatee_);
  }

  /**
   * @notice Get the current votes balance for `account`
   * @param account The address to get votes balance
   * @return The number of current votes for `account`
   */
  function getCurrentVotes(address account) external view returns (uint96) {
    uint192 userData = book[account].getLatestData();
    if (userData == 0) return 0;

    uint192 sharedData = book[address(this)].getLatestData();
    return _computeUserVotes(userData, sharedData);
  }

  /**
   * @notice Determine the prior number of votes for the given account as of the given block
   * @dev To prevent misinformation, the call reverts if the block requested is not finalized
   * @param account The address of the account to get votes for
   * @param blockNumber The block number to get votes at
   * @return The number of votes the account had as of the given block
   */
  function getPriorVotes(address account, uint256 blockNumber) public view returns (uint96) {
    return getPriorVotes(account, blockNumber, 0, 0);
  }

  /**
   * @notice Gas-optimized version of the `getPriorVotes` function -
   * it accepts IDs of checkpoints to look for voice data as of the given block in
   * (if the checkpoints miss the data, it get searched through all checkpoints recorded)
   * @dev Call (off-chain) the `findCheckpoints` function to get needed IDs
   * @param account The address of the account to get votes for
   * @param blockNumber The block number to get votes at
   * @param userCheckpointId ID of the checkpoint to look for the user data first
   * @param userCheckpointId ID of the checkpoint to look for the shared data first
   * @return The number of votes the account had as of the given block
   */
  function getPriorVotes(
    address account,
    uint256 blockNumber,
    uint32 userCheckpointId,
    uint32 sharedCheckpointId
  ) public view returns (uint96) {
    uint192 userData = book[account].getPriorData(blockNumber, userCheckpointId);
    if (userData == 0) return 0;

    uint192 sharedData = book[address(this)].getPriorData(blockNumber, sharedCheckpointId);
    return _computeUserVotes(userData, sharedData);
  }

  /// @notice Returns IDs of checkpoints which store the given account' voice computation data
  /// @dev Intended for off-chain use (by UI)
  function findCheckpoints(address account, uint256 blockNumber)
    external
    view
    returns (uint32 userCheckpointId, uint32 sharedCheckpointId)
  {
    require(account != address(0), "findCheckpoints: zero account");
    (userCheckpointId, ) = book[account].findCheckpoint(blockNumber);
    (sharedCheckpointId, ) = book[address(this)].findCheckpoint(blockNumber);
  }

  function _getCheckpoint(address account, uint32 checkpointId) internal view returns (uint32 fromBlock, uint192 data) {
    (fromBlock, data) = book[account].getCheckpoint(checkpointId);
  }

  function _writeSharedData(uint192 data) internal {
    book[address(this)].writeCheckpoint(data);
  }

  function _writeUserData(address account, uint192 data) internal {
    DelegatableCheckpoints.Record storage src = book[account];
    address _delegatee = src.delegatee;
    DelegatableCheckpoints.Record storage dst = _delegatee == address(0) ? src : book[_delegatee];

    dst.writeCheckpoint(
      // keep in mind voices which others could have delegated
      _computeUserData(dst.getLatestData(), data, delegatables[account])
    );
    delegatables[account] = data;
  }

  function _moveUserData(
    address account,
    address from,
    address to
  ) internal {
    DelegatableCheckpoints.Record storage src;
    DelegatableCheckpoints.Record storage dst;

    if (from == address(0)) {
      // no former delegatee
      src = book[account];
      dst = book[to];
    } else if (to == address(0)) {
      // delegation revoked
      src = book[from];
      dst = book[account];
    } else {
      src = book[from];
      dst = book[to];
    }
    uint192 delegatable = delegatables[account];

    uint192 srcPrevData = src.getLatestData();
    uint192 srcData = _computeUserData(srcPrevData, 0, delegatable);
    if (srcPrevData != srcData) src.writeCheckpoint(srcData);

    uint192 dstPrevData = dst.getLatestData();
    uint192 dstData = _computeUserData(dstPrevData, delegatable, 0);
    if (dstPrevData != dstData) dst.writeCheckpoint(dstData);
  }

  function _delegate(address delegator, address delegatee_) internal {
    address currentDelegate = book[delegator].delegatee;
    book[delegator].delegatee = delegatee_;

    emit DelegateChanged(delegator, currentDelegate, delegatee_);

    _moveUserData(delegator, currentDelegate, delegatee_);
  }

  function _computeUserVotes(uint192 userData, uint192 sharedData) internal pure virtual returns (uint96 votes);

  function _computeUserData(
    uint192 prevData,
    uint192 newDelegated,
    uint192 prevDelegated
  ) internal pure virtual returns (uint192 userData) {
    (uint96 prevA, uint96 prevB) = _unpackData(prevData);
    (uint96 newDelegatedA, uint96 newDelegatedB) = _unpackData(newDelegated);
    (uint96 prevDelegatedA, uint96 prevDelegatedB) = _unpackData(prevDelegated);
    userData = _packData(
      _getNewValue(prevA, newDelegatedA, prevDelegatedA),
      _getNewValue(prevB, newDelegatedB, prevDelegatedB)
    );
  }

  function _unpackData(uint192 data) internal pure virtual returns (uint96 valA, uint96 valB) {
    return (uint96(data >> 96), uint96((data << 96) >> 96));
  }

  function _packData(uint96 valA, uint96 valB) internal pure virtual returns (uint192 data) {
    return ((uint192(valA) << 96) | uint192(valB));
  }

  function _getNewValue(
    uint96 val,
    uint96 more,
    uint96 less
  ) internal pure virtual returns (uint96 newVal) {
    if (more == less) {
      newVal = val;
    } else if (more > less) {
      newVal = val.add(more.sub(less));
    } else {
      uint96 decrease = less.sub(more);
      newVal = val > decrease ? val.sub(decrease) : 0;
    }
  }

  uint256[50] private _gap; // reserved
}
