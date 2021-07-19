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

  function swapVaultToUSDC(
    address _from,
    address _to,
    address _vaultTokenIn,
    uint256 _vaultAmountIn
  ) external returns (uint256 usdcAmountOut);

  function calcVaultOutByUsdc(address _token, uint256 _usdcIn) external view returns (uint256 amountOut);

  function calcVaultPoolOutByUsdc(
    address _pool,
    uint256 _usdcIn,
    bool _withFee
  ) external view returns (uint256 amountOut);

  function calcUsdcOutByVault(address _vaultTokenIn, uint256 _vaultAmountIn)
    external
    view
    returns (uint256 usdcAmountOut);

  function calcUsdcOutByPool(
    address _pool,
    uint256 _ppolIn,
    bool _withFee
  ) external view returns (uint256 amountOut);
}
