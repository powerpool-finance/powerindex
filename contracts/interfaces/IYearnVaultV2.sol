// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

interface IYearnVaultV2 {
  function token() external view returns (address);

  function totalAssets() external view returns (uint256);

  function pricePerShare() external view returns (uint256);

  function deposit(uint256 amount) external;

  function deposit(uint256 amount, address recipient) external;

  function withdraw(uint256 maxShares) external;

  function withdraw(uint256 maxShares, address recipient) external;

  function withdraw(
    uint256 maxShares,
    address recipient,
    uint256 maxLoss
  ) external;

  function report(
    uint256 gain,
    uint256 loss,
    uint256 debtPayment
  ) external returns (uint256);
}
