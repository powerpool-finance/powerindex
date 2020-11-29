// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../powerindex-router/PowerIndexNaiveRouter.sol";

contract MockRouter is PowerIndexNaiveRouter {
  event MockWrapperCallback(uint256 withdrawAmount);

  constructor() public PowerIndexNaiveRouter() {}

  function wrapperCallback(uint256 _withdrawAmount) external virtual override {
    emit MockWrapperCallback(_withdrawAmount);
  }

  function execute(address destination, bytes calldata data) external {
    destination.call(data);
  }
}
