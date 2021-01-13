// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interfaces/BPoolInterface.sol";
import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/PowerIndexWrapperInterface.sol";
import "../lib/ControllerOwnable.sol";

import "hardhat/console.sol";

contract PowerIndexWrapper is ControllerOwnable, PowerIndexWrapperInterface {
  using SafeMath for uint256;

  event SetPiTokenForUnderlying(address indexed underlyingToken, address indexed piToken);
  event UpdatePiTokenEthFee(address indexed piToken, uint256 ethFee);

  BPoolInterface public immutable bpool;

  mapping(address => address) public piTokenByUnderlying;
  mapping(address => address) public underlyingByPiToken;
  mapping(address => uint256) public ethFeeByPiToken;

  constructor(address _bpool) public ControllerOwnable() {
    bpool = BPoolInterface(_bpool);
    BPoolInterface(_bpool).approve(_bpool, uint256(-1));

    address[] memory tokens = BPoolInterface(_bpool).getCurrentTokens();
    uint256 len = tokens.length;
    for (uint256 i = 0; i < len; i++) {
      IERC20(tokens[i]).approve(_bpool, uint256(-1));
    }
  }

  function withdrawOddEthFee(address payable _recipient) external override onlyController {
    _recipient.transfer(address(this).balance);
  }

  function setPiTokenForUnderlyingsMultiple(address[] calldata _underlyingTokens, address[] calldata _piTokens)
    external
    override
    onlyController
  {
    uint256 len = _underlyingTokens.length;
    require(len == _piTokens.length, "LENGTH_DONT_MATCH");

    for (uint256 i = 0; i < len; i++) {
      _setPiTokenForUnderlying(_underlyingTokens[i], _piTokens[i]);
    }
  }

  function setPiTokenForUnderlying(address _underlyingToken, address _piToken) external override onlyController {
    _setPiTokenForUnderlying(_underlyingToken, _piToken);
  }

  function updatePiTokenEthFees(address[] calldata _underlyingTokens) external override {
    uint256 len = _underlyingTokens.length;

    for (uint256 i = 0; i < len; i++) {
      _updatePiTokenEthFee(piTokenByUnderlying[_underlyingTokens[i]]);
    }
  }

  function swapExactAmountOut(
    address tokenIn,
    uint256 maxAmountIn,
    address tokenOut,
    uint256 tokenAmountOut,
    uint256 maxPrice
  ) external payable override returns (uint256 tokenAmountIn, uint256 spotPriceAfter) {
    (address factTokenIn, uint256 factMaxAmountIn) = _processUnderlyingTokenIn(tokenIn, maxAmountIn);
    (address factTokenOut, uint256 factTokenAmountOut) = _getFactTokenAndAmount(tokenOut, tokenAmountOut);

    uint256 prevMaxAmount = factMaxAmountIn;
    factMaxAmountIn = bpool.calcInGivenOut(
      bpool.getBalance(factTokenIn),
      bpool.getDenormalizedWeight(factTokenIn),
      bpool.getBalance(factTokenOut),
      bpool.getDenormalizedWeight(factTokenOut),
      factTokenAmountOut,
      bpool.getSwapFee()
    );
    factMaxAmountIn = prevMaxAmount > factMaxAmountIn ? factMaxAmountIn : prevMaxAmount;

    _processUnderlyingTokenIn(tokenIn, factMaxAmountIn);

    (tokenAmountIn, spotPriceAfter) = bpool.swapExactAmountOut(
      factTokenIn,
      factMaxAmountIn,
      factTokenOut,
      factTokenAmountOut,
      maxPrice
    );

    _processUnderlyingTokenOutBalance(tokenOut);

    return (tokenAmountIn, spotPriceAfter);
  }

  function swapExactAmountIn(
    address tokenIn,
    uint256 tokenAmountIn,
    address tokenOut,
    uint256 minAmountOut,
    uint256 maxPrice
  ) external payable override returns (uint256 tokenAmountOut, uint256 spotPriceAfter) {
    (address factTokenIn, uint256 factAmountIn) = _processUnderlyingTokenIn(tokenIn, tokenAmountIn);
    (address factTokenOut, uint256 factMinAmountOut) = _getFactTokenAndAmount(tokenOut, minAmountOut);

    (tokenAmountOut, spotPriceAfter) = bpool.swapExactAmountIn(
      factTokenIn,
      factAmountIn,
      factTokenOut,
      factMinAmountOut,
      maxPrice
    );

    _processUnderlyingTokenOutBalance(tokenOut);

    return (tokenAmountOut, spotPriceAfter);
  }

  function joinPool(uint256 poolAmountOut, uint256[] memory maxAmountsIn) external payable override {
    address[] memory tokens = getUnderlyingTokens();
    uint256 len = tokens.length;
    require(maxAmountsIn.length == len, "ERR_LENGTH_MISMATCH");

    uint256 ratio = poolAmountOut.mul(1 ether).div(bpool.totalSupply()).add(100);

    for (uint256 i = 0; i < len; i++) {
      (address factToken, uint256 factMaxAmountIn) = _processUnderlyingTokenIn(tokens[i], maxAmountsIn[i]);
      uint256 amountInRate = factMaxAmountIn.mul(uint256(1 ether)).div(maxAmountsIn[i]);

      uint256 prevMaxAmount = factMaxAmountIn;
      factMaxAmountIn = ratio.mul(bpool.getBalance(factToken)).div(1 ether);
      factMaxAmountIn = prevMaxAmount > factMaxAmountIn ? factMaxAmountIn : prevMaxAmount;

      _processUnderlyingOrPiTokenIn(tokens[i], factMaxAmountIn.mul(uint256(1 ether).div(amountInRate)));
      maxAmountsIn[i] = factMaxAmountIn;
    }
    bpool.joinPool(poolAmountOut, maxAmountsIn);
    require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
  }

  function exitPool(uint256 poolAmountIn, uint256[] memory minAmountsOut) external payable override {
    address[] memory tokens = getUnderlyingTokens();
    uint256 len = tokens.length;
    require(minAmountsOut.length == len, "ERR_LENGTH_MISMATCH");

    bpool.transferFrom(msg.sender, address(this), poolAmountIn);

    for (uint256 i = 0; i < len; i++) {
      (, minAmountsOut[i]) = _getFactTokenAndAmount(tokens[i], minAmountsOut[i]);
    }

    bpool.exitPool(poolAmountIn, minAmountsOut);

    for (uint256 i = 0; i < len; i++) {
      _processUnderlyingOrPiTokenOutBalance(tokens[i]);
    }
  }

  function joinswapExternAmountIn(
    address tokenIn,
    uint256 tokenAmountIn,
    uint256 minPoolAmountOut
  ) external payable override returns (uint256 poolAmountOut) {
    (address factTokenIn, uint256 factAmountIn) = _processUnderlyingTokenIn(tokenIn, tokenAmountIn);
    poolAmountOut = bpool.joinswapExternAmountIn(factTokenIn, factAmountIn, minPoolAmountOut);
    require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
    return poolAmountOut;
  }

  function joinswapPoolAmountOut(
    address tokenIn,
    uint256 poolAmountOut,
    uint256 maxAmountIn
  ) external payable override returns (uint256 tokenAmountIn) {
    (address factTokenIn, uint256 factMaxAmountIn) = _processUnderlyingTokenIn(tokenIn, maxAmountIn);

    uint256 prevMaxAmount = factMaxAmountIn;
    factMaxAmountIn = bpool.calcSingleInGivenPoolOut(
      bpool.getBalance(factTokenIn),
      bpool.getDenormalizedWeight(factTokenIn),
      bpool.totalSupply(),
      bpool.getTotalDenormalizedWeight(),
      poolAmountOut,
      bpool.getSwapFee()
    );
    maxAmountIn = prevMaxAmount > factMaxAmountIn ? factMaxAmountIn : prevMaxAmount;

    uint256 amountInRate = factMaxAmountIn.mul(uint256(1 ether)).div(maxAmountIn);
    _processUnderlyingTokenIn(tokenIn, factMaxAmountIn.mul(uint256(1 ether)).div(amountInRate));
    tokenAmountIn = bpool.joinswapPoolAmountOut(factTokenIn, poolAmountOut, factMaxAmountIn);
    require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
    return tokenAmountIn;
  }

  function exitswapPoolAmountIn(
    address tokenOut,
    uint256 poolAmountIn,
    uint256 minAmountOut
  ) external payable override returns (uint256 tokenAmountOut) {
    require(bpool.transferFrom(msg.sender, address(this), poolAmountIn), "ERR_TRANSFER_FAILED");

    address factTokenOut = _getFactToken(tokenOut);
    tokenAmountOut = bpool.exitswapPoolAmountIn(factTokenOut, poolAmountIn, minAmountOut);
    _processUnderlyingTokenOutBalance(tokenOut);
    return tokenAmountOut;
  }

  function exitswapExternAmountOut(
    address tokenOut,
    uint256 tokenAmountOut,
    uint256 maxPoolAmountIn
  ) external payable override returns (uint256 poolAmountIn) {
    require(bpool.transferFrom(msg.sender, address(this), maxPoolAmountIn), "ERR_TRANSFER_FAILED");

    address factTokenOut = _getFactToken(tokenOut);
    poolAmountIn = bpool.exitswapExternAmountOut(factTokenOut, tokenAmountOut, maxPoolAmountIn);
    _processUnderlyingTokenOutBalance(tokenOut);
    require(bpool.transfer(msg.sender, maxPoolAmountIn.sub(poolAmountIn)), "ERR_TRANSFER_FAILED");
    return poolAmountIn;
  }

  function calcInGivenOut(
    uint256 tokenBalanceIn,
    uint256 tokenWeightIn,
    uint256 tokenBalanceOut,
    uint256 tokenWeightOut,
    uint256 tokenAmountOut,
    uint256 swapFee
  ) public view returns (uint256 tokenAmountIn) {
    return
      bpool.calcInGivenOut(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountOut, swapFee);
  }

  function getBalance(address token) external view returns (uint256) {
    return bpool.getBalance(_getFactToken(token));
  }

  function getDenormalizedWeight(address token) external view returns (uint256) {
    return bpool.getDenormalizedWeight(_getFactToken(token));
  }

  function getSwapFee() external view returns (uint256) {
    return bpool.getSwapFee();
  }

  function calcEthFeeForTokens(address[] memory tokens) external view override returns (uint256 feeSum) {
    uint256 len = tokens.length;
    for (uint256 i = 0; i < len; i++) {
      address piToken = address(0);
      if (underlyingByPiToken[tokens[i]] != address(0)) {
        piToken = tokens[i];
      } else if (piTokenByUnderlying[tokens[i]] != address(0)) {
        piToken = piTokenByUnderlying[tokens[i]];
      }
      if (piToken != address(0)) {
        feeSum = feeSum.add(WrappedPiErc20EthFeeInterface(piToken).ethFee());
      }
    }
  }

  function getUnderlyingTokens() public view override returns (address[] memory tokens) {
    tokens = bpool.getCurrentTokens();

    uint256 len = tokens.length;
    for (uint256 i = 0; i < len; i++) {
      if (underlyingByPiToken[tokens[i]] != address(0)) {
        tokens[i] = underlyingByPiToken[tokens[i]];
      }
    }
  }

  function getUnderlyingBalance(address _token) external view override returns (uint256) {
    address piTokenAddress = piTokenByUnderlying[_token];
    if (piTokenAddress == address(0)) {
      return bpool.getBalance(_token);
    }
    return WrappedPiErc20EthFeeInterface(piTokenAddress).getUnderlyingEquivalentForPi(bpool.getBalance(piTokenAddress));
  }

  function _processUnderlyingTokenIn(address underlyingToken, uint256 amount) internal returns (address factToken, uint256 factAmount) {
    if (amount == 0) {
      return (underlyingToken, amount);
    }
    require(IERC20(underlyingToken).transferFrom(msg.sender, address(this), amount), "ERR_TRANSFER_FAILED");

    factToken = piTokenByUnderlying[underlyingToken];
    if (factToken == address(0)) {
      return (underlyingToken, amount);
    }
    factAmount = WrappedPiErc20Interface(factToken).deposit{ value: ethFeeByPiToken[factToken] }(amount);
  }

  function _processUnderlyingOrPiTokenIn(address underlyingOrPiToken, uint256 amount)
    internal
    returns (address factToken, uint256 factTokenAmount)
  {
    address underlyingToken = underlyingByPiToken[underlyingOrPiToken];
    return _processUnderlyingTokenIn(underlyingToken == address(0) ? underlyingOrPiToken : underlyingToken, amount);
  }

  function _processUnderlyingTokenOut(address underlyingToken, uint256 amount) internal returns (uint256 factAmount) {
    if (amount == 0) {
      return amount;
    }
    address piToken = piTokenByUnderlying[underlyingToken];

    if (piToken != address(0)) {
      factAmount = WrappedPiErc20Interface(piToken).withdraw{ value: ethFeeByPiToken[piToken] }(amount);
    } else {
      factAmount = amount;
    }

    require(IERC20(underlyingToken).transfer(msg.sender, factAmount), "ERR_TRANSFER_FAILED");
  }

  function _processUnderlyingTokenOutBalance(address underlyingToken) internal {
    address piToken = piTokenByUnderlying[underlyingToken];
    if (piToken == address(0)) {
      _processUnderlyingTokenOut(underlyingToken, IERC20(underlyingToken).balanceOf(address(this)));
    } else {
      _processUnderlyingTokenOut(underlyingToken, WrappedPiErc20Interface(piToken).balanceOf(address(this)));
    }
  }

  function _processUnderlyingOrPiTokenOutBalance(address underlyingOrPiToken) internal {
    address underlyingToken = underlyingByPiToken[underlyingOrPiToken];
    if (underlyingToken == address(0)) {
      _processUnderlyingTokenOut(underlyingOrPiToken, IERC20(underlyingOrPiToken).balanceOf(address(this)));
    } else {
      _processUnderlyingTokenOut(
        underlyingToken,
        WrappedPiErc20Interface(underlyingOrPiToken).balanceOf(address(this))
      );
    }
  }

  function _getFactToken(address token) internal view returns (address) {
    address piToken = piTokenByUnderlying[token];
    return piToken == address(0) ? token : piToken;
  }

  function _getFactTokenAndAmount(address token, uint256 amount) internal view returns (address factToken, uint256 factAmount) {
    address piToken = piTokenByUnderlying[token];
    if (piToken == address(0)) {
      return (token, amount);
    }
    return (piToken, WrappedPiErc20EthFeeInterface(piToken).getPiEquivalentForUnderlying(amount));
  }

  function _setPiTokenForUnderlying(address underlyingToken, address piToken) internal {
    piTokenByUnderlying[underlyingToken] = piToken;
    if (piToken == address(0)) {
      IERC20(underlyingToken).approve(address(bpool), uint256(-1));
    } else {
      underlyingByPiToken[piToken] = underlyingToken;
      IERC20(piToken).approve(address(bpool), uint256(-1));
      IERC20(underlyingToken).approve(piToken, uint256(-1));
      _updatePiTokenEthFee(piToken);
    }
    emit SetPiTokenForUnderlying(underlyingToken, piToken);
  }

  function _updatePiTokenEthFee(address piToken) internal {
    if (piToken == address(0)) {
      return;
    }
    uint256 ethFee = WrappedPiErc20EthFeeInterface(piToken).ethFee();
    if (ethFeeByPiToken[piToken] == ethFee) {
      return;
    }
    ethFeeByPiToken[piToken] = ethFee;
    emit UpdatePiTokenEthFee(piToken, ethFee);
  }
}

interface WrappedPiErc20EthFeeInterface {
  function ethFee() external view returns (uint256);

  function router() external view returns (address);

  function getPiEquivalentForUnderlying(uint256 _underlyingAmount) external view returns (uint256);

  function getUnderlyingEquivalentForPi(uint256 _piAmount) external view returns (uint256);
}
