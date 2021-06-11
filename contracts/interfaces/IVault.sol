// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

interface IVault {
  function token() external view returns (address);

  function totalAssets() external view returns (uint256);

  function balanceOf(address _acc) external view returns (uint256);

  function pricePerShare() external view returns (uint256);

  function deposit(uint256 _amount) external;

  function withdraw(uint256 _amount) external;
}
