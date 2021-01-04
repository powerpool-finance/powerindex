// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IPiRouterFactory {
  function buildRouter(address _piToken, bytes calldata _args) external returns (address);
}
