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
  TokenInterface public usdc;
  TokenInterface public cvp;
  BPoolInterface public pipt;
  PowerIndexWrapperInterface public piptWrapper;

  mapping(address => mapping(address => address)) public uniswapPairByTargetAndTokenAddress;
  mapping(address => address) public uniswapPairToken0;
  mapping(address => bool) public reApproveTokens;
  mapping(address => bool) public simplePairs;
  uint256 public defaultSlippage;
  uint256 public defaultDiffPercent;

  struct CalculationStruct {
    uint256 tokenAmount;
    uint256 usdAmount;
    uint256 ethAmount;
    uint256 tokenReserve;
    uint256 ethReserve;
  }

  event SetTokenSetting(address indexed token, bool indexed reApprove, address indexed uniswapPair);
  event SetDefaultSlippage(uint256 newDefaultSlippage);
  event SetPiptWrapper(address _piptWrapper);
  event SetSimplePairs(address indexed pair, bool indexed isSimple);

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
    address _usdc,
    address _cvp,
    address _pipt,
    address _piptWrapper,
    address _feeManager
  ) public {
    __Ownable_init();
    weth = TokenInterface(_weth);
    usdc = TokenInterface(_usdc);
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

  function swapPiptToEth(uint256 _poolAmountIn) external payable returns (uint256 ethOutAmount) {
    ethOutAmount = _swapPiptToWeth(_poolAmountIn);

    weth.withdraw(ethOutAmount);
    Address.sendValue(msg.sender, ethOutAmount);
  }

  function convertOddToCvpAndSendToPayout(address[] memory _oddTokens) external {
    require(msg.sender == tx.origin && !Address.isContract(msg.sender), "CONTRACT_NOT_ALLOWED");

    uint256 len = _oddTokens.length;

    for (uint256 i = 0; i < len; i++) {
      _swapTokenForWethOut(_oddTokens[i], TokenInterface(_oddTokens[i]).balanceOf(address(this)));
    }

    uint256 wethBalance = weth.balanceOf(address(this));
    uint256 cvpOut = _swapWethForTokenOut(address(cvp), wethBalance);

    cvp.safeTransfer(feePayout, cvpOut);

    emit PayoutCVP(feePayout, wethBalance, cvpOut);
  }

  function setTokensSettings(
    address[] memory _tokens,
    address[] memory _pairs,
    address _pairTargetToken,
    bool[] memory _reapprove
  ) external onlyOwner {
    uint256 len = _tokens.length;
    require(len == _pairs.length && len == _reapprove.length, "LENGTHS_NOT_EQUAL");
    for (uint256 i = 0; i < len; i++) {
      _setUniswapSettingAndPrepareToken(_pairTargetToken, _tokens[i], _pairs[i]);
      reApproveTokens[_tokens[i]] = _reapprove[i];
      emit SetTokenSetting(_tokens[i], _reapprove[i], _pairs[i]);
    }
  }

  function setSimplePairs(address[] memory _pairs, bool _isSimple) external onlyOwner {
    uint256 len = _pairs.length;
    for (uint256 i = 0; i < len; i++) {
      simplePairs[_pairs[i]] = _isSimple;
      emit SetSimplePairs(_pairs[i], _isSimple);
    }
  }

  function fetchUnswapPairsFromFactory(
    address _factory,
    address _targetToken,
    address[] calldata _tokens
  ) external onlyOwner {
    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      _setUniswapSettingAndPrepareToken(
        _targetToken,
        _tokens[i],
        IUniswapV2Factory(_factory).getPair(_tokens[i], _targetToken)
      );
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
      uint256 piptTotalSupply = pipt.totalSupply();
      // get pool out for 1 ether as 100% for calculate shares
      // poolOut by 1 ether first token join = piptTotalSupply.mul(1 ether).div(getPiptTokenBalance(_tokens[0]))
      // poolRatio = poolOut/totalSupply
      uint256 poolRatio =
        piptTotalSupply.mul(1 ether).div(getPiptTokenBalance(_tokens[0])).mul(1 ether).div(piptTotalSupply);

      for (uint256 i = 0; i < _tokens.length; i++) {
        // token share relatively 1 ether of first token
        calculations[i].tokenAmount = poolRatio.mul(getPiptTokenBalance(_tokens[i])).div(1 ether);

        address wethAddress = address(weth);
        address usdcAddress = address(usdc);
        address wethPairAddress = uniswapPairByTargetAndTokenAddress[wethAddress][_tokens[i]];

        if (wethPairAddress == address(0)) {
          address usdPairAddress = uniswapPairByTargetAndTokenAddress[usdcAddress][_tokens[i]];
          calculations[i].usdAmount = getAmountInForUniswapValue(
            IUniswapV2Pair(usdPairAddress),
            usdc,
            calculations[i].tokenAmount,
            true
          );
          calculations[i].ethAmount = getAmountInForUniswapValue(
            _uniswapPairFor(wethAddress, usdcAddress),
            weth,
            calculations[i].usdAmount,
            true
          );
        } else {
          calculations[i].ethAmount = getAmountInForUniswapValue(
            IUniswapV2Pair(wethPairAddress),
            weth,
            calculations[i].tokenAmount,
            true
          );
        }

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
      uint256[] memory usdOutUniswap,
      uint256 totalEthOut,
      uint256 poolAmountFee
    )
  {
    tokensOutPipt = new uint256[](_tokens.length);
    ethOutUniswap = new uint256[](_tokens.length);
    usdOutUniswap = new uint256[](_tokens.length);

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
      address wethAddress = address(weth);
      address usdcAddress = address(usdc);
      address wethPairAddress = uniswapPairByTargetAndTokenAddress[wethAddress][_tokens[i]];

      if (wethPairAddress == address(0)) {
        address usdPairAddress = uniswapPairByTargetAndTokenAddress[usdcAddress][_tokens[i]];
        usdOutUniswap[i] = getAmountOutForUniswapValue(
          IUniswapV2Pair(usdPairAddress),
          usdcAddress,
          tokensOutPipt[i],
          true
        );
        ethOutUniswap[i] = getAmountOutForUniswapValue(
          _uniswapPairFor(wethAddress, usdcAddress),
          wethAddress,
          usdOutUniswap[i],
          true
        );
      } else {
        ethOutUniswap[i] = getAmountOutForUniswapValue(
          IUniswapV2Pair(wethPairAddress),
          wethAddress,
          tokensOutPipt[i],
          true
        );
      }
      totalEthOut = totalEthOut.add(ethOutUniswap[i]);
    }
  }

  function calcNeedEthToPoolOut(uint256 _poolAmountOut, uint256 _slippage) public view returns (uint256) {
    uint256 ratio = _poolAmountOut.mul(1 ether).div(pipt.totalSupply()).add(100);

    address[] memory tokens = getPiptTokens();
    uint256 len = tokens.length;

    uint256[] memory tokensInPipt = new uint256[](len);

    uint256 totalEthSwap = 0;
    for (uint256 i = 0; i < len; i++) {
      tokensInPipt[i] = ratio.mul(getPiptTokenBalance(tokens[i])).div(1 ether);

      address wethAddress = address(weth);
      address usdcAddress = address(usdc);
      address wethPairAddress = uniswapPairByTargetAndTokenAddress[wethAddress][tokens[i]];

      if (wethPairAddress == address(0)) {
        address usdPairAddress = uniswapPairByTargetAndTokenAddress[usdcAddress][tokens[i]];
        uint256 usdAmount = getAmountInForUniswapValue(IUniswapV2Pair(usdPairAddress), usdc, tokensInPipt[i], true);
        totalEthSwap = getAmountInForUniswapValue(_uniswapPairFor(wethAddress, usdcAddress), weth, usdAmount, true).add(
          totalEthSwap
        );
      } else {
        totalEthSwap = getAmountInForUniswapValue(IUniswapV2Pair(wethPairAddress), weth, tokensInPipt[i], true).add(
          totalEthSwap
        );
      }
    }
    return totalEthSwap.add(totalEthSwap.mul(_slippage).div(1 ether));
  }

  function calcEthFee(uint256 _ethAmount, uint256 _wrapperFee)
    public
    view
    returns (uint256 ethFee, uint256 ethAfterFee)
  {
    return calcFee(_ethAmount, _wrapperFee);
  }

  function calcEthFee(uint256 _ethAmount) external view returns (uint256 ethFee, uint256 ethAfterFee) {
    (ethFee, ethAfterFee) = calcEthFee(_ethAmount, getWrapFee(getPiptTokens()));
  }

  function getWrapFee(address[] memory _tokens) public view returns (uint256 wrapperFee) {
    if (address(piptWrapper) != address(0)) {
      wrapperFee = piptWrapper.calcEthFeeForTokens(_tokens);
    }
  }

  function getPiptTokens() public view returns (address[] memory) {
    return address(piptWrapper) == address(0) ? pipt.getCurrentTokens() : piptWrapper.getCurrentTokens();
  }

  function getPiptTokenBalance(address _token) public view returns (uint256) {
    return address(piptWrapper) == address(0) ? pipt.getBalance(_token) : piptWrapper.getBalance(_token);
  }

  function getTokenPairs(address _token) external view returns (address wethPair, address usdPair) {
    return (
      uniswapPairByTargetAndTokenAddress[address(weth)][_token],
      uniswapPairByTargetAndTokenAddress[address(usdc)][_token]
    );
  }

  function getAmountInForUniswap(
    IUniswapV2Pair _tokenPair,
    IERC20 _targetToken,
    uint256 _swapAmount,
    bool _isEthIn
  ) public view returns (uint256 amountIn, bool isInverse) {
    isInverse = uniswapPairToken0[address(_tokenPair)] == address(_targetToken);
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
    IERC20 _targetToken,
    uint256 _swapAmount,
    bool _isEthIn
  ) public view returns (uint256 amountIn) {
    (amountIn, ) = getAmountInForUniswap(_tokenPair, _targetToken, _swapAmount, _isEthIn);
  }

  function getAmountOutForUniswap(
    IUniswapV2Pair _tokenPair,
    address _targetToken,
    uint256 _swapAmount,
    bool _isEthOut
  ) public view returns (uint256 amountOut, bool isInverse) {
    isInverse = uniswapPairToken0[address(_tokenPair)] == _targetToken;
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
    address _targetToken,
    uint256 _swapAmount,
    bool _isEthOut
  ) public view returns (uint256 ethAmount) {
    (ethAmount, ) = getAmountOutForUniswap(_tokenPair, _targetToken, _swapAmount, _isEthOut);
  }

  function _setUniswapSettingAndPrepareToken(
    address _targetToken,
    address _token,
    address _pair
  ) internal {
    uniswapPairByTargetAndTokenAddress[_targetToken][_token] = _pair;
    uniswapPairToken0[_pair] = IUniswapV2Pair(_pair).token0();
  }

  function _uniswapPairFor(address _targetToken, address _token) internal view returns (IUniswapV2Pair) {
    return IUniswapV2Pair(uniswapPairByTargetAndTokenAddress[_targetToken][_token]);
  }

  function _swapWethToPiptByPoolOut(
    uint256 _wethAmount,
    uint256 _poolAmountOut,
    address[] memory _tokens,
    uint256 _wrapperFee
  ) internal returns (uint256 poolAmountOutAfterFee, uint256 oddEth) {
    require(_wethAmount > 0, "ETH_REQUIRED");

    {
      address poolRestrictions = pipt.getRestrictions();
      if (address(poolRestrictions) != address(0)) {
        uint256 maxTotalSupply = IPoolRestrictions(poolRestrictions).getMaxTotalSupply(address(pipt));
        require(pipt.totalSupply().add(_poolAmountOut) <= maxTotalSupply, "PIPT_MAX_SUPPLY");
      }
    }

    (uint256 feeAmount, uint256 swapAmount) = calcEthFee(_wethAmount, _wrapperFee);
    (uint256[] memory tokensInPipt, uint256 totalEthSwap) = _prepareTokensForJoin(_tokens, _poolAmountOut);

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

    _joinPool(_poolAmountOut, tokensInPipt, _wrapperFee);
    totalEthSwap = totalEthSwap.add(_wrapperFee);
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
    uint256 ratio = _poolAmountOut.mul(1 ether).div(pipt.totalSupply()).add(100);
    for (uint256 i = 0; i < len; i++) {
      tokensInPipt[i] = ratio.mul(getPiptTokenBalance(_tokens[i])).div(1 ether);

      address wethAddress = address(weth);
      address usdcAddress = address(usdc);
      address wethPairAddress = uniswapPairByTargetAndTokenAddress[wethAddress][_tokens[i]];

      if (wethPairAddress == address(0)) {
        address usdPairAddress = uniswapPairByTargetAndTokenAddress[usdcAddress][_tokens[i]];
        (uint256 usdAmountIn, ) = getAmountInForUniswap(IUniswapV2Pair(usdPairAddress), usdc, tokensInPipt[i], true);

        uint256 ethAmountIn = _swapForTokenIn(weth, address(usdc), usdAmountIn);
        _swapForTokenIn(usdc, _tokens[i], tokensInPipt[i]);
        totalEthSwap = totalEthSwap.add(ethAmountIn);
      } else {
        totalEthSwap = totalEthSwap.add(_swapForTokenIn(weth, _tokens[i], tokensInPipt[i]));
      }

      address approveAddress = address(piptWrapper) == address(0) ? address(pipt) : address(piptWrapper);
      if (reApproveTokens[_tokens[i]]) {
        TokenInterface(_tokens[i]).approve(approveAddress, 0);
      }
      TokenInterface(_tokens[i]).approve(approveAddress, tokensInPipt[i]);
    }
  }

  function _swapPiptToWeth(uint256 _poolAmountIn) internal returns (uint256) {
    address[] memory tokens = getPiptTokens();
    uint256 len = tokens.length;

    (
      uint256[] memory tokensOutPipt,
      uint256[] memory ethOutUniswap,
      uint256[] memory usdOutUniswap,
      uint256 totalEthOut,
      uint256 poolAmountFee
    ) = calcSwapPiptToEthInputs(_poolAmountIn, tokens);

    pipt.safeTransferFrom(msg.sender, address(this), _poolAmountIn);

    uint256 wrapperFee = getWrapFee(tokens);

    (uint256 ethFeeAmount, uint256 ethOutAmount) = calcEthFee(totalEthOut, wrapperFee);

    _exitPool(_poolAmountIn, tokensOutPipt, wrapperFee);

    for (uint256 i = 0; i < len; i++) {
      if (usdOutUniswap[i] == 0) {
        IUniswapV2Pair wethPair = _uniswapPairFor(address(weth), tokens[i]);
        _swapToken(
          tokens[i],
          wethPair,
          tokensOutPipt[i],
          ethOutUniswap[i],
          uniswapPairToken0[address(wethPair)] == address(weth)
        );
      } else {
        IUniswapV2Pair usdcPair = _uniswapPairFor(address(usdc), tokens[i]);
        _swapToken(
          tokens[i],
          usdcPair,
          tokensOutPipt[i],
          usdOutUniswap[i],
          uniswapPairToken0[address(usdcPair)] == address(usdc)
        );
        IUniswapV2Pair wethPair = _uniswapPairFor(address(weth), address(usdc));
        _swapToken(
          address(usdc),
          wethPair,
          usdOutUniswap[i],
          ethOutUniswap[i],
          uniswapPairToken0[address(wethPair)] == address(weth)
        );
      }
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
        weth.withdraw(_wrapperFee);
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

  function _swapForTokenIn(
    IERC20 _tokenIn,
    address _erc20,
    uint256 _erc20Out
  ) internal returns (uint256 amountIn) {
    IUniswapV2Pair tokenPair = _uniswapPairFor(address(_tokenIn), _erc20);
    bool isInverse;
    (amountIn, isInverse) = getAmountInForUniswap(tokenPair, _tokenIn, _erc20Out, true);
    _swapToken(address(_tokenIn), tokenPair, amountIn, _erc20Out, !isInverse);
  }

  function _swapWethForTokenOut(address _erc20, uint256 _ethIn) internal returns (uint256 erc20Out) {
    IUniswapV2Pair tokenPair = _uniswapPairFor(address(weth), _erc20);
    bool isInverse;
    (erc20Out, isInverse) = getAmountOutForUniswap(tokenPair, address(weth), _ethIn, false);
    _swapToken(address(weth), tokenPair, _ethIn, erc20Out, !isInverse);
  }

  function _swapTokenForWethOut(address _erc20, uint256 _erc20In) internal returns (uint256 ethOut) {
    IUniswapV2Pair tokenPair = _uniswapPairFor(address(weth), _erc20);
    bool isInverse;
    (ethOut, isInverse) = getAmountOutForUniswap(tokenPair, address(weth), _erc20In, true);
    _swapToken(_erc20, tokenPair, _erc20In, ethOut, isInverse);
  }

  function _swapToken(
    address _token,
    IUniswapV2Pair _tokenPair,
    uint256 _amountIn,
    uint256 _amountOut,
    bool _isInverse
  ) internal {
    IERC20(_token).safeTransfer(address(_tokenPair), _amountIn);
    uint256 amount0 = _isInverse ? _amountOut : uint256(0);
    uint256 amount1 = _isInverse ? uint256(0) : _amountOut;
    if (simplePairs[address(_tokenPair)]) {
      _tokenPair.swap(amount0, amount1, address(this));
    } else {
      _tokenPair.swap(amount0, amount1, address(this), new bytes(0));
    }
  }
}
