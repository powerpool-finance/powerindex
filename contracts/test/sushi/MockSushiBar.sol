// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./SushiBar.sol";

contract MockSushiBar is SushiBar {
  constructor(IERC20 _sushi) public SushiBar(_sushi) {}

  function leave(uint256) public override {}
}
