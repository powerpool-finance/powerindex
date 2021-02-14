// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

contract MockProxyCall {
  function makeCall(address destination, bytes calldata payload) external {
    (bool ok, bytes memory data) = destination.call(payload);

    if (!ok) {
      assembly {
        let size := returndatasize()
        revert(add(data, 32), size)
      }
    }
  }
}
