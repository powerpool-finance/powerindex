// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

interface IAutoFarmStrategy {
  function wantLockedTotal() external view returns (uint256);

  function sharesTotal() external view returns (uint256);

  function earn() external;

  function deposit(address _userAddress, uint256 _wantAmt) external returns (uint256);

  function withdraw(address _userAddress, uint256 _wantAmt) external returns (uint256);

  function inCaseTokensGetStuck(
    address _token,
    uint256 _amount,
    address _to
  ) external;
}
