// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IErc20VaultPoolSwap {
  function swapErc20ToVaultPool(
    address _pool,
    address _swapToken,
    uint256 _swapAmount
  ) external returns (uint256 poolAmountOut);

  function swapVaultPoolToErc20(
    address _pool,
    uint256 _poolAmountIn,
    address _swapToken
  ) external returns (uint256 erc20Out);

  function swapVaultToUSDC(address _vaultTokenIn, uint256 _vaultAmountIn) external returns (uint256 usdcAmountOut);
}
