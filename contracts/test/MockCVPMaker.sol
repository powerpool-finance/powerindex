// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../pvp/CVPMaker.sol";

contract MockCVPMaker is CVPMaker {
  constructor(
    address cvp_,
    address xcvp_,
    address weth_,
    address uniswapRouter_
  ) public CVPMaker(cvp_, xcvp_, weth_, uniswapRouter_) {}

  function mockSwap(address token_) external {
    _swap(token_);
  }
}
