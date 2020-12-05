// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexNaiveRouterInterface {
  function migrateToNewRouter(address _wrappedToken, address _newRouter) external;

  function wrapperCallback(uint256 _withdrawAmount) external;
}
