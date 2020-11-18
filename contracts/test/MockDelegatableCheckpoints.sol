// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "../lib/DelegatableCheckpoints.sol";

contract MockDelegatableCheckpoints {
  using DelegatableCheckpoints for DelegatableCheckpoints.Record;

  mapping(address => DelegatableCheckpoints.Record) public records;

  function getLatestData(address user) public view returns (uint192) {
    return records[user].getLatestData();
  }

  function getPriorData(
    address user,
    uint256 blockNumber,
    uint256 checkpointId
  ) public view returns (uint192) {
    return records[user].getPriorData(blockNumber, checkpointId);
  }

  function findCheckpoint(address user, uint256 blockNumber) public view returns (uint32 id, uint192 data) {
    (id, data) = records[user].findCheckpoint(blockNumber);
  }

  event DEBUG32(uint32);

  function writeCheckpoint(address user, uint192 data) public returns (uint32 id) {
    id = records[user].writeCheckpoint(data);
    emit DEBUG32(id);
  }

  function getProperties(address user)
    public
    view
    returns (
      uint32 numCheckpoints,
      uint32 lastCheckpointBlock,
      address delegatee
    )
  {
    return records[user].getProperties();
  }

  function writeDelegatee(address user, address delegatee) public {
    records[user].writeDelegatee(delegatee);
  }
}
