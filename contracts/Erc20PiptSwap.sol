// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./EthPiptSwap.sol";

contract Erc20PiptSwap is EthPiptSwap {
  event Erc20ToPiptSwap(
    address indexed user,
    address indexed swapToken,
    uint256 erc20InAmount,
    uint256 ethInAmount,
    uint256 poolOutAmount
  );
  event PiptToErc20Swap(
    address indexed user,
    address indexed swapToken,
    uint256 poolInAmount,
    uint256 ethOutAmount,
    uint256 erc20OutAmount
  );

  constructor(
    address _weth,
    address _cvp,
    address _pipt,
    address _feeManager
  ) public EthPiptSwap(_weth, _cvp, _pipt, _feeManager) {}

  function swapErc20ToPipt(
    address _swapToken,
    uint256 _swapAmount,
    uint256 _slippage
  ) external {
    IERC20(_swapToken).safeTransferFrom(msg.sender, address(this), _swapAmount);

    IUniswapV2Pair tokenPair = _uniswapPairFor(_swapToken);
    (uint256 tokenReserve, uint256 ethReserve, ) = tokenPair.getReserves();
    uint256 ethAmount = UniswapV2Library.getAmountOut(_swapAmount, tokenReserve, ethReserve);

    IERC20(_swapToken).safeTransfer(address(tokenPair), _swapAmount);
    tokenPair.swap(uint256(0), ethAmount, address(this), new bytes(0));

    (, uint256 ethSwapAmount) = calcEthFee(ethAmount);
    address[] memory tokens = pipt.getCurrentTokens();
    (, , uint256 poolAmountOut) = calcSwapEthToPiptInputs(ethSwapAmount, tokens, _slippage);

    _swapWethToPiptByPoolOut(ethAmount, poolAmountOut);

    emit Erc20ToPiptSwap(msg.sender, _swapToken, _swapAmount, ethAmount, poolAmountOut);
  }

  function swapPiptToErc20(address _swapToken, uint256 _poolAmountIn) external {
    uint256 ethOut = _swapPiptToWeth(_poolAmountIn);

    IUniswapV2Pair tokenPair = _uniswapPairFor(_swapToken);

    (uint256 tokenReserve, uint256 ethReserve, ) = tokenPair.getReserves();
    uint256 erc20Out = UniswapV2Library.getAmountOut(ethOut, ethReserve, tokenReserve);

    weth.safeTransfer(address(tokenPair), ethOut);

    tokenPair.swap(erc20Out, uint256(0), address(this), new bytes(0));

    IERC20(_swapToken).safeTransfer(msg.sender, erc20Out);

    emit PiptToErc20Swap(msg.sender, _swapToken, _poolAmountIn, ethOut, erc20Out);
  }

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
    )
  {
    (uint256 tokenReserve, uint256 ethReserve, ) = _uniswapPairFor(_swapToken).getReserves();
    uint256 ethAmount = UniswapV2Library.getAmountOut(_swapAmount, tokenReserve, ethReserve);
    if (_withFee) {
      (, ethAmount) = calcEthFee(ethAmount);
    }
    return calcSwapEthToPiptInputs(ethAmount, _tokens, _slippage);
  }

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
    )
  {
    uint256 totalEthOut;

    (tokensOutPipt, ethOutUniswap, totalEthOut, poolAmountFee) = calcSwapPiptToEthInputs(_poolAmountIn, _tokens);
    if (_withFee) {
      (, totalEthOut) = calcEthFee(totalEthOut);
    }
    (uint256 tokenReserve, uint256 ethReserve, ) = _uniswapPairFor(_swapToken).getReserves();
    totalErc20Out = UniswapV2Library.getAmountOut(totalEthOut, ethReserve, tokenReserve);
  }

  function calcErc20Fee(address _swapToken, uint256 _swapAmount)
    external
    view
    returns (
      uint256 erc20Fee,
      uint256 erc20AfterFee,
      uint256 ethFee,
      uint256 ethAfterFee
    )
  {
    (uint256 tokenReserve, uint256 ethReserve, ) = _uniswapPairFor(_swapToken).getReserves();
    uint256 ethAmount = UniswapV2Library.getAmountOut(_swapAmount, tokenReserve, ethReserve);

    (ethFee, ethAfterFee) = calcEthFee(ethAmount);

    if (ethFee != 0) {
      erc20Fee = UniswapV2Library.getAmountOut(ethFee, ethReserve, tokenReserve);
    }
    erc20AfterFee = UniswapV2Library.getAmountOut(ethAfterFee, ethReserve, tokenReserve);
  }
}
