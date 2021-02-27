// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./MCapWeightAbstract.sol";
import "./WeightValueStrategy.sol";

contract MCapWeightStrategy is WeightValueStrategy, MCapWeightAbstract {
  constructor() public OwnableUpgradeSafe() {}

  function getTokenValue(PowerIndexPoolInterface _pool, address _token) public view override returns (uint256) {
    return getTokenMCap(_pool, _token);
  }
}
