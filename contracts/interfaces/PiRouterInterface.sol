// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PiRouterInterface {
  function migrateWrappedTokensToNewRouter(address[] calldata wrappedTokens, address newRouter) external;

  function wrapperCallback(uint256 withdrawAmount) external;
}
