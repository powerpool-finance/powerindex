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
    (address factTokenIn, uint256 factMaxAmountIn) = _getFactTokenAndAmount(tokenIn, maxAmountIn);
    (address factTokenOut, uint256 factTokenAmountOut) = _getFactTokenAndAmount(tokenOut, tokenAmountOut);
    uint256 factMaxPrice = getFactMaxPrice(maxAmountIn, factMaxAmountIn, tokenAmountOut, factTokenAmountOut, maxPrice);
    uint256 amountInRate = factMaxAmountIn.mul(uint256(1 ether)).div(maxAmountIn);

    uint256 prevMaxAmount = factMaxAmountIn;
    factMaxAmountIn = calcInGivenOut(
      bpool.getBalance(factTokenIn),
      bpool.getDenormalizedWeight(factTokenIn),
      bpool.getBalance(factTokenOut),
      bpool.getDenormalizedWeight(factTokenOut),
      factTokenAmountOut,
      bpool.getSwapFee()
    );
    if (prevMaxAmount > factMaxAmountIn) {
      maxAmountIn = factMaxAmountIn.mul(uint256(1 ether)).div(amountInRate);
    } else {
      factMaxAmountIn = prevMaxAmount;
    }

    _processUnderlyingTokenIn(tokenIn, maxAmountIn);

    (tokenAmountIn, spotPriceAfter) = bpool.swapExactAmountOut(
      factTokenIn,
      factMaxAmountIn,
      factTokenOut,
      factTokenAmountOut,
      factMaxPrice
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
    (address factTokenIn, uint256 factAmountIn) = _processUnderlyingTokenIn(tokenIn, tokenAmountIn);
    (address factTokenOut, uint256 factMinAmountOut) = _getFactTokenAndAmount(tokenOut, minAmountOut);
    uint256 factMaxPrice = getFactMaxPrice(tokenAmountIn, factAmountIn, minAmountOut, factMinAmountOut, maxPrice);

    (tokenAmountOut, spotPriceAfter) = bpool.swapExactAmountIn(
      factTokenIn,
      factAmountIn,
      factTokenOut,
      factMinAmountOut,
      factMaxPrice
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
      (address factToken, uint256 factMaxAmountIn) = _getFactTokenAndAmount(tokens[i], maxAmountsIn[i]);
      uint256 amountInRate = factMaxAmountIn.mul(uint256(1 ether)).div(maxAmountsIn[i]);

      uint256 prevMaxAmount = factMaxAmountIn;
      factMaxAmountIn = ratio.mul(bpool.getBalance(factToken)).div(1 ether);
      if (prevMaxAmount > factMaxAmountIn) {
        maxAmountsIn[i] = factMaxAmountIn.mul(uint256(1 ether)).div(amountInRate);
      } else {
        factMaxAmountIn = prevMaxAmount;
      }

      _processUnderlyingTokenIn(tokens[i], maxAmountsIn[i]);
      maxAmountsIn[i] = factMaxAmountIn;
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
      address factToken;
      (factToken, minAmountsOut[i]) = _getFactTokenAndAmount(tokens[i], minAmountsOut[i]);
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
    (address factTokenIn, uint256 factMaxAmountIn) = _getFactTokenAndAmount(tokenIn, maxAmountIn);
    uint256 amountInRate = factMaxAmountIn.mul(uint256(1 ether)).div(maxAmountIn);

    uint256 prevMaxAmount = maxAmountIn;
    maxAmountIn = calcSingleInGivenPoolOut(
      getBalance(tokenIn),
      bpool.getDenormalizedWeight(factTokenIn),
      bpool.totalSupply(),
      bpool.getTotalDenormalizedWeight(),
      poolAmountOut,
      bpool.getSwapFee()
    );
    if (prevMaxAmount > maxAmountIn) {
      maxAmountIn = maxAmountIn;
      factMaxAmountIn = maxAmountIn.mul(amountInRate).div(uint256(1 ether));
    } else {
      maxAmountIn = prevMaxAmount;
    }

    _processUnderlyingTokenIn(tokenIn, maxAmountIn);
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

    (address factTokenOut, uint256 factMinAmountOut) = _getFactTokenAndAmount(tokenOut, minAmountOut);
    tokenAmountOut = bpool.exitswapPoolAmountIn(factTokenOut, poolAmountIn, factMinAmountOut);
    _processUnderlyingOrPiTokenOutBalance(tokenOut);
    return tokenAmountOut;
  }

  function exitswapExternAmountOut(
    address tokenOut,
    uint256 tokenAmountOut,
    uint256 maxPoolAmountIn
  ) external payable override returns (uint256 poolAmountIn) {
    require(bpool.transferFrom(msg.sender, address(this), maxPoolAmountIn), "ERR_TRANSFER_FAILED");

    (address factTokenOut, uint256 factTokenAmountOut) = _getFactTokenAndAmount(tokenOut, tokenAmountOut);
    poolAmountIn = bpool.exitswapExternAmountOut(factTokenOut, factTokenAmountOut, maxPoolAmountIn);
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

  function getFactMaxPrice(
    uint256 amountIn,
    uint256 factAmountIn,
    uint256 amountOut,
    uint256 factAmountOut,
    uint256 maxPrice
  ) public returns (uint256 factMaxPrice) {
    uint256 amountInRate = amountIn.mul(uint256(1 ether)).div(factAmountIn);
    uint256 amountOutRate = factAmountOut.mul(uint256(1 ether)).div(amountOut);
    return
      amountInRate > amountOutRate
        ? maxPrice.mul(amountInRate).div(amountOutRate)
        : maxPrice.mul(amountOutRate).div(amountInRate);
  }

  function _processUnderlyingTokenIn(address _underlyingToken, uint256 _amount)
    internal
    returns (address factToken, uint256 factAmount)
  {
    if (_amount == 0) {
      return (_underlyingToken, _amount);
    }
    require(IERC20(_underlyingToken).transferFrom(msg.sender, address(this), _amount), "ERR_TRANSFER_FAILED");

    factToken = piTokenByUnderlying[_underlyingToken];
    if (factToken == address(0)) {
      return (_underlyingToken, _amount);
    }
    factAmount = WrappedPiErc20Interface(factToken).deposit{ value: ethFeeByPiToken[factToken] }(_amount);
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

  function _getFactToken(address token) internal view returns (address) {
    address piToken = piTokenByUnderlying[token];
    return piToken == address(0) ? token : piToken;
  }

  function _getFactTokenAndAmount(address token, uint256 amount)
    internal
    view
    returns (address factToken, uint256 factAmount)
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
