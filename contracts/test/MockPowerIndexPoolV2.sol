// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../PowerIndexPool.sol";

contract MockPowerIndexPoolV2 is PowerIndexPool {
  uint256 public test;

  function setTest(uint256 _test) public {
    test = _test;
  }
}
