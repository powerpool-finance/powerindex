// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface WrappedPiErc20Interface {
  function deposit(uint256 _amount) external;

  function withdraw(uint256 _amount) external;

  function changeRouter(address _newRouter) external;

  function approveToken(address _to, uint256 _amount) external;

  function callVoting(
    address voting,
    bytes4 signature,
    bytes calldata args,
    uint256 value
  ) external;

  function getWrappedBalance() external returns (uint256);

  function balanceOf(address account) external view returns (uint256);

  function approve(address spender, uint256 amount) external returns (bool);
}
