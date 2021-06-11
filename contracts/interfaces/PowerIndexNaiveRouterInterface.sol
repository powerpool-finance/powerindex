// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexNaiveRouterInterface {
  function migrateToNewRouter(
    address _piToken,
    address payable _newRouter,
    address[] memory _tokens
  ) external;

  function piTokenCallback(address sender, uint256 _withdrawAmount) external payable;
}
