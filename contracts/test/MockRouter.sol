// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../powerindex-router/PowerIndexBasicRouter.sol";

contract MockRouter is PowerIndexBasicRouter {
  event MockWrapperCallback(uint256 withdrawAmount);

  constructor(address _piToken, BasicConfig memory _basicConfig)
    public
    PowerIndexBasicRouter(_piToken, _basicConfig)
  {}

  function piTokenCallback(uint256 _withdrawAmount) external virtual override {
    emit MockWrapperCallback(_withdrawAmount);
  }

  function execute(address destination, bytes calldata data) external {
    destination.call(data);
  }
}
