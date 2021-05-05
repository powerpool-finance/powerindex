// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../powerindex-router/PowerIndexWrapper.sol";

contract MockPowerIndexWrapper is PowerIndexWrapper {
  constructor(address _bpool) public PowerIndexWrapper(_bpool) {}

  receive() external payable {}
}
