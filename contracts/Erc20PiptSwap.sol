/*
https://powerpool.finance/

          wrrrw r wrr
         ppwr rrr wppr0       prwwwrp                                 prwwwrp                   wr0
        rr 0rrrwrrprpwp0      pp   pr  prrrr0 pp   0r  prrrr0  0rwrrr pp   pr  prrrr0  prrrr0    r0
        rrp pr   wr00rrp      prwww0  pp   wr pp w00r prwwwpr  0rw    prwww0  pp   wr pp   wr    r0
        r0rprprwrrrp pr0      pp      wr   pr pp rwwr wr       0r     pp      wr   pr wr   pr    r0
         prwr wrr0wpwr        00        www0   0w0ww    www0   0w     00        www0    www0   0www0
          wrr ww0rrrr

*/
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
    address _piptWrapper,
    address _feeManager
  ) public EthPiptSwap(_weth, _cvp, _pipt, _piptWrapper, _feeManager) {}

  function swapErc20ToPipt(
    address _swapToken,
    uint256 _swapAmount,
    uint256 _slippage
  ) external returns (uint256 poolAmountOut) {
    IERC20(_swapToken).safeTransferFrom(msg.sender, address(this), _swapAmount);

    uint256 ethAmount = _swapTokenForWethOut(_swapToken, _swapAmount);

    address[] memory tokens = pipt.getCurrentTokens();
    uint256 wrapperFee = getWrapFee(tokens);
    (, uint256 ethSwapAmount) = calcEthFee(ethAmount, wrapperFee);
    (, , poolAmountOut) = calcSwapEthToPiptInputs(ethSwapAmount, tokens, _slippage);

    _swapWethToPiptByPoolOut(ethAmount, poolAmountOut, tokens, wrapperFee);

    emit Erc20ToPiptSwap(msg.sender, _swapToken, _swapAmount, ethAmount, poolAmountOut);
  }

  function swapPiptToErc20(address _swapToken, uint256 _poolAmountIn) external returns (uint256 erc20Out) {
    uint256 ethOut = _swapPiptToWeth(_poolAmountIn);

    uint256 erc20Out = _swapWethForTokenOut(_swapToken, ethOut);

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
    uint256 ethAmount = getAmountOutForUniswapValue(_uniswapPairFor(_swapToken), _swapAmount, true);

    if (_withFee) {
      (, ethAmount) = calcEthFee(ethAmount, getWrapFee(_tokens));
    }
    return calcSwapEthToPiptInputs(ethAmount, _tokens, _slippage);
  }

  function calcNeedErc20ToPoolOut(
    address _swapToken,
    uint256 _poolAmountOut,
    uint256 _slippage
  ) external view returns (uint256) {
    uint256 resultEth = calcNeedEthToPoolOut(_poolAmountOut, _slippage);

    IUniswapV2Pair tokenPair = _uniswapPairFor(_swapToken);
    (uint256 token1Reserve, uint256 token2Reserve, ) = tokenPair.getReserves();
    if (tokenPair.token0() == address(weth)) {
      return UniswapV2Library.getAmountIn(resultEth.mul(1003).div(1000), token2Reserve, token1Reserve);
    } else {
      return UniswapV2Library.getAmountIn(resultEth.mul(1003).div(1000), token1Reserve, token2Reserve);
    }
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
      (, totalEthOut) = calcEthFee(totalEthOut, getWrapFee(_tokens));
    }
    totalErc20Out = getAmountOutForUniswapValue(_uniswapPairFor(_swapToken), totalEthOut, false);
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
    IUniswapV2Pair tokenPair = _uniswapPairFor(_swapToken);

    uint256 ethAmount = getAmountOutForUniswapValue(tokenPair, _swapAmount, true);

    (ethFee, ethAfterFee) = calcEthFee(ethAmount, getWrapFee(pipt.getCurrentTokens()));

    if (ethFee != 0) {
      erc20Fee = getAmountOutForUniswapValue(tokenPair, ethFee, false);
    }
    erc20AfterFee = getAmountOutForUniswapValue(tokenPair, ethAfterFee, false);
  }
}
