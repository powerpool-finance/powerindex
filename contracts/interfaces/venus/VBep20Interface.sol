// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

interface VBep20Interface {
  function mint(uint256 mintAmount) external returns (uint256);

  function redeem(uint256 redeemTokens) external returns (uint256);

  function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

  function borrow(uint256 borrowAmount) external returns (uint256);

  function repayBorrow(uint256 repayAmount) external returns (uint256);

  function repayBorrowBehalf(address borrower, uint256 repayAmount) external returns (uint256);

  function comptroller() external view returns (address);

  function underlying() external view returns (address);

  function accrueInterest() external returns (uint256);

  function exchangeRateStored() external view returns (uint256);
}
