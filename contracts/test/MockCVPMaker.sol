// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../pvp/CVPMaker.sol";
import "../pvp/CVPMakerLens.sol";

contract MockCVPMaker is CVPMakerLens, CVPMaker {
  constructor(
    address cvp_,
    address xcvp_,
    address weth_,
    address uniswapRouter_,
    address restrictions_
  ) public CVPMaker(cvp_, xcvp_, weth_, uniswapRouter_, restrictions_) {}

  function mockSwap(address token_) external {
    _swap(token_);
  }
}
