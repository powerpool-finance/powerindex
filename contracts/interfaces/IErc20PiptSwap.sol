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

  function swapPiptToEth(uint256 _poolAmountIn) external payable returns (uint256 ethOutAmount);

  function swapPiptToErc20(address _swapToken, uint256 _poolAmountIn) external payable returns (uint256 erc20Out);

  function calcSwapErc20ToPiptInputs(
    address _swapToken,
    uint256 _swapAmount,
    address[] memory _tokens,
    uint256 _slippage,
    bool _withFee
  )
    external
    view
    returns (
      uint256[] memory tokensInPipt,
      uint256[] memory ethInUniswap,
      uint256 poolOut
    );

  function calcSwapPiptToErc20Inputs(
    address _swapToken,
    uint256 _poolAmountIn,
    address[] memory _tokens,
    bool _withFee
  )
    external
    view
    returns (
      uint256[] memory tokensOutPipt,
      uint256[] memory ethOutUniswap,
      uint256 totalErc20Out,
      uint256 poolAmountFee
    );

  function calcSwapPiptToEthInputs(uint256 _poolAmountIn, address[] memory _tokens)
    external
    view
    returns (
      uint256[] memory tokensOutPipt,
      uint256[] memory ethOutUniswap,
      uint256 totalEthOut,
      uint256 poolAmountFee
    );

  function calcSwapEthToPiptInputs(
    uint256 _ethValue,
    address[] memory _tokens,
    uint256 _slippage
  )
    external
    view
    returns (
      uint256[] memory tokensInPipt,
      uint256[] memory ethInUniswap,
      uint256 poolOut
    );
}
