// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface WrappedPiErc20Interface is IERC20 {
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

  function getWrappedBalance() external view returns (uint256);
}
