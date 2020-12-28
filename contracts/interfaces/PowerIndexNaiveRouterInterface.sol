// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexNaiveRouterInterface {
  function migrateToNewRouter(address _piToken, address _newRouter) external;

  function piTokenCallback(uint256 _withdrawAmount) external;
}
