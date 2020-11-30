// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexNaiveRouterInterface {
  function migrateWrappedTokensToNewRouter(address[] calldata _wrappedTokens, address _newRouter) external;
  function wrapperCallback(uint256 _withdrawAmount) external;
}
