// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/BPoolInterface.sol";
import "./interfaces/PowerIndexWrapperInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./interfaces/IPoolRestrictions.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./lib/UniswapV2Library.sol";
import "./traits/ProgressiveFee.sol";

contract EthPiptSwap is ProgressiveFee {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;
  using SafeERC20 for TokenInterface;
  using SafeERC20 for BPoolInterface;

  TokenInterface public weth;
  TokenInterface public cvp;
  BPoolInterface public pipt;
  PowerIndexWrapperInterface public piptWrapper;

  mapping(address => address) public uniswapEthPairByTokenAddress;
  mapping(address => address) public uniswapEthPairToken0;
  mapping(address => bool) public reApproveTokens;
  uint256 public defaultSlippage;
  uint256 public defaultDiffPercent;

  struct CalculationStruct {
    uint256 tokenAmount;
    uint256 ethAmount;
    uint256 tokenReserve;
    uint256 ethReserve;
  }

  event SetTokenSetting(address indexed token, bool indexed reApprove, address indexed uniswapPair);
  event SetDefaultSlippage(uint256 newDefaultSlippage);
  event SetPiptWrapper(address _piptWrapper);

  event EthToPiptSwap(
    address indexed user,
    uint256 ethInAmount,
    uint256 ethSwapFee,
    uint256 poolOutAmount,
    uint256 poolCommunityFee
  );
  event OddEth(address indexed user, uint256 amount);
  event PiptToEthSwap(
    address indexed user,
    uint256 poolInAmount,
    uint256 poolCommunityFee,
    uint256 ethOutAmount,
    uint256 ethSwapFee
  );
  event PayoutCVP(address indexed receiver, uint256 wethAmount, uint256 cvpAmount);

  constructor(
    address _weth,
    address _cvp,
    address _pipt,
    address _piptWrapper,
    address _feeManager
  ) public {
    __Ownable_init();
    weth = TokenInterface(_weth);
    cvp = TokenInterface(_cvp);
    pipt = BPoolInterface(_pipt);
    piptWrapper = PowerIndexWrapperInterface(_piptWrapper);
    feeManager = _feeManager;
    defaultSlippage = 0.02 ether;
    defaultDiffPercent = 0.04 ether;
  }

  receive() external payable {
    if (msg.sender != tx.origin) {
      return;
    }
    swapEthToPipt(defaultSlippage, defaultDiffPercent, 0);
  }

  function swapEthToPipt(
    uint256 _slippage,
    uint256 _minPoolAmount,
    uint256 _maxDiffPercent
  ) public payable returns (uint256 poolAmountOutAfterFee, uint256 oddEth) {
    address[] memory tokens = getPiptTokens();

    uint256 wrapperFee = getWrapFee(tokens);
    (, uint256 swapAmount) = calcEthFee(msg.value, wrapperFee);

    (, uint256[] memory ethInUniswap, uint256 poolAmountOut) = calcSwapEthToPiptInputs(swapAmount, tokens, _slippage);
    require(poolAmountOut >= _minPoolAmount, "MIN_POOL_AMOUNT_OUT");
    require(_maxDiffPercent >= getMaxDiffPercent(ethInUniswap), "MAX_DIFF_PERCENT");

    weth.deposit{ value: msg.value }();

    return _swapWethToPiptByPoolOut(msg.value, poolAmountOut, tokens, wrapperFee);
  }

  function getMaxDiffPercent(uint256[] memory _ethInUniswap) public view returns (uint256 maxDiffPercent) {
    uint256 len = _ethInUniswap.length;
    uint256 minEthInUniswap = _ethInUniswap[0];
    for (uint256 i = 1; i < len; i++) {
      if (_ethInUniswap[i] < minEthInUniswap) {
        minEthInUniswap = _ethInUniswap[i];
      }
    }
    for (uint256 i = 0; i < len; i++) {
      uint256 diffPercent = _ethInUniswap[i].mul(1 ether).div(minEthInUniswap);
      diffPercent = diffPercent > 1 ether ? diffPercent - 1 ether : 1 ether - diffPercent;
      if (diffPercent > maxDiffPercent) {
        maxDiffPercent = diffPercent;
      }
    }
  }

  function swapEthToPiptByPoolOut(uint256 _poolAmountOut)
    external
    payable
    returns (uint256 poolAmountOutAfterFee, uint256 oddEth)
  {
    weth.deposit{ value: msg.value }();

    address[] memory tokens = getPiptTokens();
    return _swapWethToPiptByPoolOut(msg.value, _poolAmountOut, tokens, getWrapFee(tokens));
  }

  function swapPiptToEth(uint256 _poolAmountIn, uint256 _minEthAmountOut)
    external
    payable
    returns (uint256 ethOutAmount)
  {
    ethOutAmount = _swapPiptToWeth(_poolAmountIn, _minEthAmountOut);

    weth.withdraw(ethOutAmount);
    Address.sendValue(msg.sender, ethOutAmount);
  }

  function convertOddToCvpAndSendToPayout(address[] memory oddTokens) external {
    require(msg.sender == tx.origin && !Address.isContract(msg.sender), "CONTRACT_NOT_ALLOWED");

    uint256 len = oddTokens.length;

    for (uint256 i = 0; i < len; i++) {
      _swapTokenForWethOut(oddTokens[i], TokenInterface(oddTokens[i]).balanceOf(address(this)));
    }

    uint256 wethBalance = weth.balanceOf(address(this));
    uint256 cvpOut = _swapWethForTokenOut(address(cvp), wethBalance);

    cvp.safeTransfer(feePayout, cvpOut);

    emit PayoutCVP(feePayout, wethBalance, cvpOut);
  }

  function setTokensSettings(
    address[] memory _tokens,
    address[] memory _pairs,
    bool[] memory _reapprove
  ) external onlyOwner {
    uint256 len = _tokens.length;
    require(len == _pairs.length && len == _reapprove.length, "LENGTHS_NOT_EQUAL");
    for (uint256 i = 0; i < len; i++) {
      _setUniswapSettingAndPrepareToken(_tokens[i], _pairs[i]);
      reApproveTokens[_tokens[i]] = _reapprove[i];
      emit SetTokenSetting(_tokens[i], _reapprove[i], _pairs[i]);
    }
  }

  function fetchUnswapPairsFromFactory(address _factory, address[] calldata _tokens) external onlyOwner {
    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      _setUniswapSettingAndPrepareToken(_tokens[i], IUniswapV2Factory(_factory).getPair(_tokens[i], address(weth)));
    }
  }

  function setDefaultSlippage(uint256 _defaultSlippage) external onlyOwner {
    defaultSlippage = _defaultSlippage;
    emit SetDefaultSlippage(_defaultSlippage);
  }

  function setPiptWrapper(address _piptWrapper) external onlyOwner {
    piptWrapper = PowerIndexWrapperInterface(_piptWrapper);
    emit SetPiptWrapper(_piptWrapper);
  }

  function calcSwapEthToPiptInputs(
    uint256 _ethValue,
    address[] memory _tokens,
    uint256 _slippage
  )
    public
    view
    returns (
      uint256[] memory tokensInPipt,
      uint256[] memory ethInUniswap,
      uint256 poolOut
    )
  {
    _ethValue = _ethValue.sub(_ethValue.mul(_slippage).div(1 ether));

    // get shares and eth required for each share
    CalculationStruct[] memory calculations = new CalculationStruct[](_tokens.length);

    uint256 totalEthRequired = 0;
    {
      uint256 poolRatio = uint256(1e36).div(getPiptTokenBalance(_tokens[0]));

      for (uint256 i = 0; i < _tokens.length; i++) {
        // token share relatively 1 ether of first token
        calculations[i].tokenAmount = poolRatio.mul(getPiptTokenBalance(_tokens[i])).div(1 ether);
        calculations[i].ethAmount = getAmountInForUniswapValue(
          _uniswapPairFor(_tokens[i]),
          calculations[i].tokenAmount,
          true
        );
        totalEthRequired = totalEthRequired.add(calculations[i].ethAmount);
      }
    }

    // calculate eth and tokensIn based on shares and normalize if totalEthRequired more than 100%
    tokensInPipt = new uint256[](_tokens.length);
    ethInUniswap = new uint256[](_tokens.length);
    for (uint256 i = 0; i < _tokens.length; i++) {
      ethInUniswap[i] = _ethValue.mul(calculations[i].ethAmount.mul(1 ether).div(totalEthRequired)).div(1 ether);
      tokensInPipt[i] = calculations[i].tokenAmount.mul(_ethValue.mul(1 ether).div(totalEthRequired)).div(1 ether);
    }

    poolOut = pipt.totalSupply().mul(tokensInPipt[0]).div(getPiptTokenBalance(_tokens[0]));
  }

  function calcSwapPiptToEthInputs(uint256 _poolAmountIn, address[] memory _tokens)
    public
    view
    returns (
      uint256[] memory tokensOutPipt,
      uint256[] memory ethOutUniswap,
      uint256 totalEthOut,
      uint256 poolAmountFee
    )
  {
    tokensOutPipt = new uint256[](_tokens.length);
    ethOutUniswap = new uint256[](_tokens.length);

    (, , uint256 communityExitFee, ) = pipt.getCommunityFee();

    uint256 poolAmountInAfterFee;
    (poolAmountInAfterFee, poolAmountFee) = pipt.calcAmountWithCommunityFee(
      _poolAmountIn,
      communityExitFee,
      address(this)
    );

    uint256 poolRatio = poolAmountInAfterFee.mul(1 ether).div(pipt.totalSupply());

    totalEthOut = 0;
    for (uint256 i = 0; i < _tokens.length; i++) {
      tokensOutPipt[i] = poolRatio.mul(getPiptTokenBalance(_tokens[i])).div(1 ether);
      ethOutUniswap[i] = getAmountOutForUniswapValue(_uniswapPairFor(_tokens[i]), tokensOutPipt[i], true);
      totalEthOut = totalEthOut.add(ethOutUniswap[i]);
    }
  }

  function calcNeedEthToPoolOut(uint256 _poolAmountOut, uint256 _slippage) public view returns (uint256) {
    uint256 ratio = calcRatioToJoin(_poolAmountOut, pipt.totalSupply());

    address[] memory tokens = getPiptTokens();
    uint256 len = tokens.length;

    CalculationStruct[] memory calculations = new CalculationStruct[](len);
    uint256[] memory tokensInPipt = new uint256[](len);

    uint256 totalEthSwap = 0;
    for (uint256 i = 0; i < len; i++) {
      tokensInPipt[i] = ratio.mul(getPiptTokenBalance(tokens[i])).div(1 ether);
      totalEthSwap = getAmountInForUniswapValue(_uniswapPairFor(tokens[i]), tokensInPipt[i], true).add(totalEthSwap);
    }
    return totalEthSwap.add(totalEthSwap.mul(_slippage).div(1 ether));
  }

  function calcRatioToJoin(uint256 _poolAmountOut, uint256 _totalSupply) public view returns (uint256) {
    // add 100 wei to ratio to make tokensInPipt values bigger as well as totalEthSwap to avoid LIMIT_IN errors on joinPool
    return _poolAmountOut.mul(1 ether).div(_totalSupply).add(100);
  }

  function calcEthFee(uint256 ethAmount, uint256 wrapperFee) public view returns (uint256 ethFee, uint256 ethAfterFee) {
    return calcFee(ethAmount, wrapperFee);
  }

  function calcEthFee(uint256 ethAmount) external view returns (uint256 ethFee, uint256 ethAfterFee) {
    (ethFee, ethAfterFee) = calcEthFee(ethAmount, getWrapFee(getPiptTokens()));
  }

  function getWrapFee(address[] memory tokens) public view returns (uint256 wrapperFee) {
    if (address(piptWrapper) != address(0)) {
      wrapperFee = piptWrapper.calcEthFeeForTokens(tokens);
    }
  }

  function getPiptTokens() public view returns (address[] memory) {
    return address(piptWrapper) == address(0) ? pipt.getCurrentTokens() : piptWrapper.getCurrentTokens();
  }

  function getPiptTokenBalance(address _token) public view returns (uint256) {
    return address(piptWrapper) == address(0) ? pipt.getBalance(_token) : piptWrapper.getBalance(_token);
  }

  function getAmountInForUniswap(
    IUniswapV2Pair _tokenPair,
    uint256 _swapAmount,
    bool _isEthIn
  ) public view returns (uint256 amountIn, bool isInverse) {
    isInverse = uniswapEthPairToken0[address(_tokenPair)] == address(weth);
    if (_isEthIn ? !isInverse : isInverse) {
      (uint256 ethReserve, uint256 tokenReserve, ) = _tokenPair.getReserves();
      amountIn = UniswapV2Library.getAmountIn(_swapAmount, tokenReserve, ethReserve);
    } else {
      (uint256 tokenReserve, uint256 ethReserve, ) = _tokenPair.getReserves();
      amountIn = UniswapV2Library.getAmountIn(_swapAmount, tokenReserve, ethReserve);
    }
  }

  function getAmountInForUniswapValue(
    IUniswapV2Pair _tokenPair,
    uint256 _swapAmount,
    bool _isEthIn
  ) public view returns (uint256 amountIn) {
    (amountIn, ) = getAmountInForUniswap(_tokenPair, _swapAmount, _isEthIn);
  }

  function getAmountOutForUniswap(
    IUniswapV2Pair _tokenPair,
    uint256 _swapAmount,
    bool _isEthOut
  ) public view returns (uint256 amountOut, bool isInverse) {
    isInverse = uniswapEthPairToken0[address(_tokenPair)] == address(weth);
    if (_isEthOut ? isInverse : !isInverse) {
      (uint256 ethReserve, uint256 tokenReserve, ) = _tokenPair.getReserves();
      amountOut = UniswapV2Library.getAmountOut(_swapAmount, tokenReserve, ethReserve);
    } else {
      (uint256 tokenReserve, uint256 ethReserve, ) = _tokenPair.getReserves();
      amountOut = UniswapV2Library.getAmountOut(_swapAmount, tokenReserve, ethReserve);
    }
  }

  function getAmountOutForUniswapValue(
    IUniswapV2Pair _tokenPair,
    uint256 _swapAmount,
    bool _isEthOut
  ) public view returns (uint256 ethAmount) {
    (ethAmount, ) = getAmountOutForUniswap(_tokenPair, _swapAmount, _isEthOut);
  }

  function _setUniswapSettingAndPrepareToken(address _token, address _pair) internal {
    uniswapEthPairByTokenAddress[_token] = _pair;
    uniswapEthPairToken0[_pair] = IUniswapV2Pair(_pair).token0();
  }

  function _uniswapPairFor(address token) internal view returns (IUniswapV2Pair) {
    return IUniswapV2Pair(uniswapEthPairByTokenAddress[token]);
  }

  function _swapWethToPiptByPoolOut(
    uint256 _wethAmount,
    uint256 _poolAmountOut,
    address[] memory tokens,
    uint256 wrapperFee
  ) internal returns (uint256 poolAmountOutAfterFee, uint256 oddEth) {
    require(_wethAmount > 0, "ETH_REQUIRED");

    {
      address poolRestrictions = pipt.getRestrictions();
      if (address(poolRestrictions) != address(0)) {
        uint256 maxTotalSupply = IPoolRestrictions(poolRestrictions).getMaxTotalSupply(address(pipt));
        require(pipt.totalSupply().add(_poolAmountOut) <= maxTotalSupply, "PIPT_MAX_SUPPLY");
      }
    }

    (uint256 feeAmount, uint256 swapAmount) = calcEthFee(_wethAmount, wrapperFee);
    (uint256[] memory tokensInPipt, uint256 totalEthSwap) = _prepareTokensForJoin(tokens, _poolAmountOut);

    {
      uint256 poolAmountOutFee;
      (, uint256 communityJoinFee, , ) = pipt.getCommunityFee();
      (poolAmountOutAfterFee, poolAmountOutFee) = pipt.calcAmountWithCommunityFee(
        _poolAmountOut,
        communityJoinFee,
        address(this)
      );

      emit EthToPiptSwap(msg.sender, swapAmount, feeAmount, _poolAmountOut, poolAmountOutFee);
    }

    _joinPool(_poolAmountOut, tokensInPipt, wrapperFee);
    totalEthSwap = totalEthSwap.add(wrapperFee);
    pipt.safeTransfer(msg.sender, poolAmountOutAfterFee);

    oddEth = swapAmount.sub(totalEthSwap);
    if (oddEth > 0) {
      weth.withdraw(oddEth);
      Address.sendValue(msg.sender, oddEth);
      emit OddEth(msg.sender, oddEth);
    }
  }

  function _prepareTokensForJoin(address[] memory _tokens, uint256 _poolAmountOut)
    internal
    returns (uint256[] memory tokensInPipt, uint256 totalEthSwap)
  {
    uint256 len = _tokens.length;
    tokensInPipt = new uint256[](len);
    uint256 ratio = calcRatioToJoin(_poolAmountOut, pipt.totalSupply());
    for (uint256 i = 0; i < len; i++) {
      tokensInPipt[i] = ratio.mul(getPiptTokenBalance(_tokens[i])).div(1 ether);
      totalEthSwap = totalEthSwap.add(_swapWethForTokenIn(_tokens[i], tokensInPipt[i]));

      address approveAddress = address(piptWrapper) == address(0) ? address(pipt) : address(piptWrapper);
      if (reApproveTokens[_tokens[i]]) {
        TokenInterface(_tokens[i]).approve(approveAddress, 0);
      }
      TokenInterface(_tokens[i]).approve(approveAddress, tokensInPipt[i]);
    }
  }

  function _swapPiptToWeth(uint256 _poolAmountIn, uint256 _minEthAmountOut) internal returns (uint256) {
    address[] memory tokens = getPiptTokens();
    uint256 len = tokens.length;

    (uint256[] memory tokensOutPipt, uint256[] memory ethOutUniswap, uint256 totalEthOut, uint256 poolAmountFee) =
      calcSwapPiptToEthInputs(_poolAmountIn, tokens);

    pipt.safeTransferFrom(msg.sender, address(this), _poolAmountIn);

    uint256 wrapperFee = getWrapFee(tokens);

    (uint256 ethFeeAmount, uint256 ethOutAmount) = calcEthFee(totalEthOut, wrapperFee);
    require(ethOutAmount >= _minEthAmountOut, "MIN_ETH_AMOUNT_OUT");

    _exitPool(_poolAmountIn, tokensOutPipt, wrapperFee);

    for (uint256 i = 0; i < len; i++) {
      IUniswapV2Pair tokenPair = _uniswapPairFor(tokens[i]);
      TokenInterface(tokens[i]).safeTransfer(address(tokenPair), tokensOutPipt[i]);
      tokenPair.swap(uint256(0), ethOutUniswap[i], address(this), new bytes(0));
    }

    emit PiptToEthSwap(msg.sender, _poolAmountIn, poolAmountFee, ethOutAmount, ethFeeAmount);

    return ethOutAmount;
  }

  function _joinPool(
    uint256 _poolAmountOut,
    uint256[] memory _maxAmountsIn,
    uint256 _wrapperFee
  ) internal {
    if (address(piptWrapper) == address(0)) {
      pipt.joinPool(_poolAmountOut, _maxAmountsIn);
    } else {
      if (address(this).balance < _wrapperFee) {
        weth.withdraw(_wrapperFee.sub(address(this).balance));
      }
      piptWrapper.joinPool{ value: _wrapperFee }(_poolAmountOut, _maxAmountsIn);
    }
  }

  function _exitPool(
    uint256 _poolAmountIn,
    uint256[] memory _minAmountsOut,
    uint256 _wrapperFee
  ) internal {
    pipt.approve(address(piptWrapper) == address(0) ? address(pipt) : address(piptWrapper), _poolAmountIn);

    if (address(piptWrapper) == address(0)) {
      pipt.exitPool(_poolAmountIn, _minAmountsOut);
    } else {
      piptWrapper.exitPool{ value: _wrapperFee }(_poolAmountIn, _minAmountsOut);
    }
  }

  function _swapWethForTokenIn(address _erc20, uint256 _erc20Out) internal returns (uint256 ethIn) {
    IUniswapV2Pair tokenPair = _uniswapPairFor(_erc20);
    bool isInverse;
    (ethIn, isInverse) = getAmountInForUniswap(tokenPair, _erc20Out, true);
    weth.safeTransfer(address(tokenPair), ethIn);
    tokenPair.swap(isInverse ? uint256(0) : _erc20Out, isInverse ? _erc20Out : uint256(0), address(this), new bytes(0));
  }

  function _swapWethForTokenOut(address _erc20, uint256 _ethIn) internal returns (uint256 erc20Out) {
    IUniswapV2Pair tokenPair = _uniswapPairFor(_erc20);
    bool isInverse;
    (erc20Out, isInverse) = getAmountOutForUniswap(tokenPair, _ethIn, false);
    weth.safeTransfer(address(tokenPair), _ethIn);
    tokenPair.swap(isInverse ? uint256(0) : erc20Out, isInverse ? erc20Out : uint256(0), address(this), new bytes(0));
  }

  function _swapTokenForWethOut(address _erc20, uint256 _erc20In) internal returns (uint256 ethOut) {
    IUniswapV2Pair tokenPair = _uniswapPairFor(_erc20);
    bool isInverse;
    (ethOut, isInverse) = getAmountOutForUniswap(tokenPair, _erc20In, true);
    IERC20(_erc20).safeTransfer(address(tokenPair), _erc20In);
    tokenPair.swap(isInverse ? ethOut : uint256(0), isInverse ? uint256(0) : ethOut, address(this), new bytes(0));
  }
}
