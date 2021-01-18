// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../balancer-core/BMath.sol";
import "../interfaces/BPoolInterface.sol";
import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/PowerIndexWrapperInterface.sol";
import "../lib/ControllerOwnable.sol";

contract PowerIndexWrapper is ControllerOwnable, BMath, PowerIndexWrapperInterface {
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
    (address actualTokenIn, uint256 actualMaxAmountIn) = _getActualTokenAndAmount(tokenIn, maxAmountIn);
    (address actualTokenOut, uint256 actualTokenAmountOut) = _getActualTokenAndAmount(tokenOut, tokenAmountOut);
    uint256 actualMaxPrice =
      getActualMaxPrice(maxAmountIn, actualMaxAmountIn, tokenAmountOut, actualTokenAmountOut, maxPrice);
    uint256 amountInRate = actualMaxAmountIn.mul(uint256(1 ether)).div(maxAmountIn);

    uint256 prevMaxAmount = actualMaxAmountIn;
    actualMaxAmountIn = calcInGivenOut(
      bpool.getBalance(actualTokenIn),
      bpool.getDenormalizedWeight(actualTokenIn),
      bpool.getBalance(actualTokenOut),
      bpool.getDenormalizedWeight(actualTokenOut),
      actualTokenAmountOut,
      bpool.getSwapFee()
    );
    if (prevMaxAmount > actualMaxAmountIn) {
      maxAmountIn = actualMaxAmountIn.mul(uint256(1 ether)).div(amountInRate);
    } else {
      actualMaxAmountIn = prevMaxAmount;
    }

    _processUnderlyingTokenIn(tokenIn, maxAmountIn);

    (tokenAmountIn, spotPriceAfter) = bpool.swapExactAmountOut(
      actualTokenIn,
      actualMaxAmountIn,
      actualTokenOut,
      actualTokenAmountOut,
      actualMaxPrice
    );

    _processUnderlyingOrPiTokenOutBalance(tokenOut);

    return (tokenAmountIn, spotPriceAfter);
  }

  function swapExactAmountIn(
    address tokenIn,
    uint256 tokenAmountIn,
    address tokenOut,
    uint256 minAmountOut,
    uint256 maxPrice
  ) external payable override returns (uint256 tokenAmountOut, uint256 spotPriceAfter) {
    (address actualTokenIn, uint256 actualAmountIn) = _processUnderlyingTokenIn(tokenIn, tokenAmountIn);
    (address actualTokenOut, uint256 actualMinAmountOut) = _getActualTokenAndAmount(tokenOut, minAmountOut);
    uint256 actualMaxPrice =
      getActualMaxPrice(tokenAmountIn, actualAmountIn, minAmountOut, actualMinAmountOut, maxPrice);

    (tokenAmountOut, spotPriceAfter) = bpool.swapExactAmountIn(
      actualTokenIn,
      actualAmountIn,
      actualTokenOut,
      actualMinAmountOut,
      actualMaxPrice
    );

    _processUnderlyingOrPiTokenOutBalance(tokenOut);

    return (tokenAmountOut, spotPriceAfter);
  }

  function joinPool(uint256 poolAmountOut, uint256[] memory maxAmountsIn) external payable override {
    address[] memory tokens = getCurrentTokens();
    uint256 len = tokens.length;
    require(maxAmountsIn.length == len, "ERR_LENGTH_MISMATCH");

    uint256 ratio = poolAmountOut.mul(1 ether).div(bpool.totalSupply()).add(100);

    for (uint256 i = 0; i < len; i++) {
      (address actualToken, uint256 actualMaxAmountIn) = _getActualTokenAndAmount(tokens[i], maxAmountsIn[i]);
      uint256 amountInRate = actualMaxAmountIn.mul(uint256(1 ether)).div(maxAmountsIn[i]);

      uint256 prevMaxAmount = actualMaxAmountIn;
      actualMaxAmountIn = ratio.mul(bpool.getBalance(actualToken)).div(1 ether);
      if (prevMaxAmount > actualMaxAmountIn) {
        maxAmountsIn[i] = actualMaxAmountIn.mul(uint256(1 ether)).div(amountInRate);
      } else {
        actualMaxAmountIn = prevMaxAmount;
      }

      _processUnderlyingTokenIn(tokens[i], maxAmountsIn[i]);
      maxAmountsIn[i] = actualMaxAmountIn;
    }
    bpool.joinPool(poolAmountOut, maxAmountsIn);
    require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
  }

  function exitPool(uint256 poolAmountIn, uint256[] memory minAmountsOut) external payable override {
    address[] memory tokens = getCurrentTokens();
    uint256 len = tokens.length;
    require(minAmountsOut.length == len, "ERR_LENGTH_MISMATCH");

    bpool.transferFrom(msg.sender, address(this), poolAmountIn);

    for (uint256 i = 0; i < len; i++) {
      (, minAmountsOut[i]) = _getActualTokenAndAmount(tokens[i], minAmountsOut[i]);
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
    (address actualTokenIn, uint256 actualAmountIn) = _processUnderlyingTokenIn(tokenIn, tokenAmountIn);
    poolAmountOut = bpool.joinswapExternAmountIn(actualTokenIn, actualAmountIn, minPoolAmountOut);
    require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
    return poolAmountOut;
  }

  function joinswapPoolAmountOut(
    address tokenIn,
    uint256 poolAmountOut,
    uint256 maxAmountIn
  ) external payable override returns (uint256 tokenAmountIn) {
    (address actualTokenIn, uint256 actualMaxAmountIn) = _getActualTokenAndAmount(tokenIn, maxAmountIn);
    uint256 amountInRate = actualMaxAmountIn.mul(uint256(1 ether)).div(maxAmountIn);

    uint256 prevMaxAmount = maxAmountIn;
    maxAmountIn = calcSingleInGivenPoolOut(
      getBalance(tokenIn),
      bpool.getDenormalizedWeight(actualTokenIn),
      bpool.totalSupply(),
      bpool.getTotalDenormalizedWeight(),
      poolAmountOut,
      bpool.getSwapFee()
    );
    if (prevMaxAmount > maxAmountIn) {
      maxAmountIn = maxAmountIn;
      actualMaxAmountIn = maxAmountIn.mul(amountInRate).div(uint256(1 ether));
    } else {
      maxAmountIn = prevMaxAmount;
    }

    _processUnderlyingTokenIn(tokenIn, maxAmountIn);
    tokenAmountIn = bpool.joinswapPoolAmountOut(actualTokenIn, poolAmountOut, actualMaxAmountIn);
    require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
    return tokenAmountIn;
  }

  function exitswapPoolAmountIn(
    address tokenOut,
    uint256 poolAmountIn,
    uint256 minAmountOut
  ) external payable override returns (uint256 tokenAmountOut) {
    require(bpool.transferFrom(msg.sender, address(this), poolAmountIn), "ERR_TRANSFER_FAILED");

    (address actualTokenOut, uint256 actualMinAmountOut) = _getActualTokenAndAmount(tokenOut, minAmountOut);
    tokenAmountOut = bpool.exitswapPoolAmountIn(actualTokenOut, poolAmountIn, actualMinAmountOut);
    _processUnderlyingOrPiTokenOutBalance(tokenOut);
    return tokenAmountOut;
  }

  function exitswapExternAmountOut(
    address tokenOut,
    uint256 tokenAmountOut,
    uint256 maxPoolAmountIn
  ) external payable override returns (uint256 poolAmountIn) {
    require(bpool.transferFrom(msg.sender, address(this), maxPoolAmountIn), "ERR_TRANSFER_FAILED");

    (address actualTokenOut, uint256 actualTokenAmountOut) = _getActualTokenAndAmount(tokenOut, tokenAmountOut);
    poolAmountIn = bpool.exitswapExternAmountOut(actualTokenOut, actualTokenAmountOut, maxPoolAmountIn);
    _processUnderlyingOrPiTokenOutBalance(tokenOut);
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
  ) public pure override returns (uint256) {
    return
      super.calcInGivenOut(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountOut, swapFee).add(
        1
      );
  }

  function calcSingleInGivenPoolOut(
    uint256 tokenBalanceIn,
    uint256 tokenWeightIn,
    uint256 poolSupply,
    uint256 totalWeight,
    uint256 poolAmountOut,
    uint256 swapFee
  ) public pure override returns (uint256) {
    return
      super
        .calcSingleInGivenPoolOut(tokenBalanceIn, tokenWeightIn, poolSupply, totalWeight, poolAmountOut, swapFee)
        .add(1);
  }

  function calcPoolInGivenSingleOut(
    uint256 tokenBalanceOut,
    uint256 tokenWeightOut,
    uint256 poolSupply,
    uint256 totalWeight,
    uint256 tokenAmountOut,
    uint256 swapFee
  ) public pure override returns (uint256) {
    return
      super
        .calcPoolInGivenSingleOut(tokenBalanceOut, tokenWeightOut, poolSupply, totalWeight, tokenAmountOut, swapFee)
        .add(1);
  }

  function calcSpotPrice(
    uint256 tokenBalanceIn,
    uint256 tokenWeightIn,
    uint256 tokenBalanceOut,
    uint256 tokenWeightOut,
    uint256 swapFee
  ) public pure override returns (uint256) {
    return super.calcSpotPrice(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, swapFee).add(1);
  }

  function calcOutGivenIn(
    uint256 tokenBalanceIn,
    uint256 tokenWeightIn,
    uint256 tokenBalanceOut,
    uint256 tokenWeightOut,
    uint256 tokenAmountIn,
    uint256 swapFee
  ) public pure override returns (uint256) {
    return
      super.calcOutGivenIn(tokenBalanceIn, tokenWeightIn, tokenBalanceOut, tokenWeightOut, tokenAmountIn, swapFee).sub(
        10
      );
  }

  function calcPoolOutGivenSingleIn(
    uint256 tokenBalanceIn,
    uint256 tokenWeightIn,
    uint256 poolSupply,
    uint256 totalWeight,
    uint256 tokenAmountIn,
    uint256 swapFee
  ) public pure override returns (uint256) {
    return
      super
        .calcPoolOutGivenSingleIn(tokenBalanceIn, tokenWeightIn, poolSupply, totalWeight, tokenAmountIn, swapFee)
        .sub(10);
  }

  function calcSingleOutGivenPoolIn(
    uint256 tokenBalanceOut,
    uint256 tokenWeightOut,
    uint256 poolSupply,
    uint256 totalWeight,
    uint256 poolAmountIn,
    uint256 swapFee
  ) public pure override returns (uint256) {
    return
      super
        .calcSingleOutGivenPoolIn(tokenBalanceOut, tokenWeightOut, poolSupply, totalWeight, poolAmountIn, swapFee)
        .sub(10);
  }

  function getDenormalizedWeight(address token) external view returns (uint256) {
    return bpool.getDenormalizedWeight(_getActualToken(token));
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

  function getCurrentTokens() public view override returns (address[] memory tokens) {
    tokens = bpool.getCurrentTokens();

    uint256 len = tokens.length;
    for (uint256 i = 0; i < len; i++) {
      if (underlyingByPiToken[tokens[i]] != address(0)) {
        tokens[i] = underlyingByPiToken[tokens[i]];
      }
    }
  }

  function getFinalTokens() public view override returns (address[] memory tokens) {
    return getCurrentTokens();
  }

  function getBalance(address _token) public view override returns (uint256) {
    address piTokenAddress = piTokenByUnderlying[_token];
    if (piTokenAddress == address(0)) {
      return bpool.getBalance(_token);
    }
    return WrappedPiErc20EthFeeInterface(piTokenAddress).getUnderlyingEquivalentForPi(bpool.getBalance(piTokenAddress));
  }

  function getActualMaxPrice(
    uint256 amountIn,
    uint256 actualAmountIn,
    uint256 amountOut,
    uint256 actualAmountOut,
    uint256 maxPrice
  ) public returns (uint256 actualMaxPrice) {
    uint256 amountInRate = amountIn.mul(uint256(1 ether)).div(actualAmountIn);
    uint256 amountOutRate = actualAmountOut.mul(uint256(1 ether)).div(amountOut);
    return
      amountInRate > amountOutRate
        ? maxPrice.mul(amountInRate).div(amountOutRate)
        : maxPrice.mul(amountOutRate).div(amountInRate);
  }

  function _processUnderlyingTokenIn(address _underlyingToken, uint256 _amount)
    internal
    returns (address actualToken, uint256 actualAmount)
  {
    if (_amount == 0) {
      return (_underlyingToken, _amount);
    }
    require(IERC20(_underlyingToken).transferFrom(msg.sender, address(this), _amount), "ERR_TRANSFER_FAILED");

    actualToken = piTokenByUnderlying[_underlyingToken];
    if (actualToken == address(0)) {
      return (_underlyingToken, _amount);
    }
    actualAmount = WrappedPiErc20Interface(actualToken).deposit{ value: ethFeeByPiToken[actualToken] }(_amount);
  }

  function _processPiTokenOutBalance(address _piToken) internal {
    uint256 balance = WrappedPiErc20EthFeeInterface(_piToken).balanceOfUnderlying(address(this));

    WrappedPiErc20Interface(_piToken).withdraw{ value: ethFeeByPiToken[_piToken] }(balance);

    require(IERC20(underlyingByPiToken[_piToken]).transfer(msg.sender, balance), "ERR_TRANSFER_FAILED");
  }

  function _processUnderlyingTokenOutBalance(address _underlyingToken) internal returns (uint256 balance) {
    balance = IERC20(_underlyingToken).balanceOf(address(this));
    require(IERC20(_underlyingToken).transfer(msg.sender, balance), "ERR_TRANSFER_FAILED");
  }

  function _processUnderlyingOrPiTokenOutBalance(address _underlyingOrPiToken) internal {
    address piToken = piTokenByUnderlying[_underlyingOrPiToken];
    if (piToken == address(0)) {
      _processUnderlyingTokenOutBalance(_underlyingOrPiToken);
    } else {
      _processPiTokenOutBalance(piToken);
    }
  }

  function _getActualToken(address token) internal view returns (address) {
    address piToken = piTokenByUnderlying[token];
    return piToken == address(0) ? token : piToken;
  }

  function _getActualTokenAndAmount(address token, uint256 amount)
    internal
    view
    returns (address actualToken, uint256 actualAmount)
  {
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

  function balanceOfUnderlying(address _account) external view returns (uint256);
}
