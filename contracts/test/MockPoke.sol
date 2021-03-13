// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract MockPoke {
  uint256 minInterval;
  uint256 maxInterval;

  constructor() public {}

  function authorizeReporter(uint256 _reporterId, address _acc) public view returns (bool) {
    return true;
  }

  function authorizeNonReporter(uint256 _reporterId, address _acc) public view returns (bool) {
    return true;
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
