// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../powerindex-router/PowerIndexSimpleRouter.sol";

contract MockRouter is PowerIndexSimpleRouter {
  event MockWrapperCallback(uint256 withdrawAmount);

  function wrapperCallback(uint256 _withdrawAmount) external virtual override {
    emit MockWrapperCallback(_withdrawAmount);
  }

  function execute(address destination, bytes calldata data) external {
    destination.call(data);
  }
}
