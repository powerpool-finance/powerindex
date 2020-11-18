// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../powerindex-mining/DelegatableVotes.sol";

contract MockDelegatableVotes is DelegatableVotes {
  function __writeUserData(address account, uint192 data) public {
    _writeUserData(account, data);
  }

  function __writeSharedData(uint192 data) public {
    _writeSharedData(data);
  }

  function __moveUserData(
    address account,
    address from,
    address to
  ) public {
    _moveUserData(account, from, to);
  }

  function __getCheckpoint(address account, uint32 checkpointId) public view returns (uint32 fromBlock, uint192 data) {
    return _getCheckpoint(account, checkpointId);
  }

  function _computeUserVotes(uint192 userData, uint192 sharedData) internal pure override returns (uint96 votes) {
    votes = uint96(userData + sharedData);
  }
}
