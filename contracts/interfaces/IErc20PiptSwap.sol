// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IErc20PiptSwap {
  function swapEthToPipt(
    uint256 _slippage,
    uint256 _minPoolAmount,
    uint256 _maxDiffPercent
  ) external payable returns (uint256 poolAmountOutAfterFee, uint256 oddEth);

  function swapErc20ToPipt(
    address _swapToken,
    uint256 _swapAmount,
    uint256 _slippage,
    uint256 _minPoolAmount,
    uint256 _diffPercent
  ) external payable returns (uint256 poolAmountOut);

  function defaultSlippage() external view returns (uint256);

  function defaultDiffPercent() external view returns (uint256);

  function swapPiptToEth(uint256 _poolAmountIn, uint256 _minEthAmountOut)
    external
    payable
    returns (uint256 ethOutAmount);

  function swapPiptToErc20(
    address _swapToken,
    uint256 _poolAmountIn,
    uint256 _minErc20Out
  ) external payable returns (uint256 erc20Out);
}
