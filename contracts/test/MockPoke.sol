// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract MockPoke {
  uint256 minInterval;
  uint256 maxInterval;

  mapping(uint256 => mapping(address => bool)) authorizedReporters;
  mapping(uint256 => mapping(address => bool)) authorizedSlashers;

  bool simpleImpl;

  constructor(bool _simpleImpl) public {
    simpleImpl = _simpleImpl;
  }

  function setReporter(
    uint256 _reporterId,
    address _acc,
    bool _authorized
  ) public {
    authorizedReporters[_reporterId][_acc] = _authorized;
  }

  function setSlasher(
    uint256 _reporterId,
    address _acc,
    bool _authorized
  ) public {
    authorizedSlashers[_reporterId][_acc] = _authorized;
  }

  function authorizeReporter(uint256 _reporterId, address _acc) public view {
    if (simpleImpl) {
      return;
    }
    require(authorizedReporters[_reporterId][_acc], "NOT_HDH");
  }

  function authorizeNonReporter(uint256 _reporterId, address _acc) public view {
    if (simpleImpl) {
      return;
    }
    require(authorizedSlashers[_reporterId][_acc], "INVALID_POKER_KEY");
  }

  function setMinMaxReportIntervals(uint256 _minInterval, uint256 _maxInterval) public {
    minInterval = _minInterval;
    maxInterval = _maxInterval;
  }

  function getMinMaxReportIntervals(address _acc) public view returns (uint256, uint256) {
    return (minInterval, maxInterval);
  }

  function reward(
    uint256 userId_,
    uint256 gasUsed_,
    uint256 compensationPlan_,
    bytes calldata pokeOptions_
  ) public {
    // nothing
  }
}
