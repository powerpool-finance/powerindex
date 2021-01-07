// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/BPoolInterface.sol";
import "./interfaces/PowerIndexWrapperInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./interfaces/IPoolRestrictions.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./lib/UniswapV2Library.sol";

contract EthPiptSwap is Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;
  using SafeERC20 for TokenInterface;
  using SafeERC20 for BPoolInterface;

  TokenInterface public weth;
  TokenInterface public cvp;
  BPoolInterface public pipt;
  PowerIndexWrapperInterface public piptWrapper;

  uint256[] public feeLevels;
  uint256[] public feeAmounts;
  address public feePayout;
  address public feeManager;

  mapping(address => address) public uniswapEthPairByTokenAddress;
  mapping(address => address) public uniswapEthPairToken0;
  mapping(address => bool) public reApproveTokens;
  uint256 public defaultSlippage;

  struct CalculationStruct {
    uint256 tokenAmount;
    uint256 ethAmount;
    uint256 tokenReserve;
    uint256 ethReserve;
  }

  event SetTokenSetting(address indexed token, bool indexed reApprove, address indexed uniswapPair);
  event SetDefaultSlippage(uint256 newDefaultSlippage);
  event SetPiptWrapper(address _piptWrapper);
  event SetFees(
    address indexed sender,
    uint256[] newFeeLevels,
    uint256[] newFeeAmounts,
    address indexed feePayout,
    address indexed feeManager
  );

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
  ) public Ownable() {
    weth = TokenInterface(_weth);
    cvp = TokenInterface(_cvp);
    pipt = BPoolInterface(_pipt);
    piptWrapper = PowerIndexWrapperInterface(_piptWrapper);
    feeManager = _feeManager;
    defaultSlippage = 0.02 ether;
  }

  modifier onlyFeeManagerOrOwner() {
    require(msg.sender == feeManager || msg.sender == owner(), "NOT_FEE_MANAGER");
    _;
  }

  receive() external payable {
    if (msg.sender != tx.origin) {
      return;
    }
    swapEthToPipt(defaultSlippage);
  }

  function swapEthToPipt(uint256 _slippage) public payable returns (uint256 poolAmountOutAfterFee, uint256 oddEth) {
    address[] memory tokens = pipt.getCurrentTokens();

    uint256 wrapperFee = getWrapFee(tokens);
    (, uint256 swapAmount) = calcEthFee(msg.value, wrapperFee);

    (, , uint256 poolAmountOut) = calcSwapEthToPiptInputs(swapAmount, tokens, _slippage);

    weth.deposit{ value: msg.value }();

    return _swapWethToPiptByPoolOut(msg.value, poolAmountOut, tokens, wrapperFee);
  }

  function swapEthToPiptByPoolOut(uint256 _poolAmountOut)
    external
    payable
    returns (uint256 poolAmountOutAfterFee, uint256 oddEth)
  {
    weth.deposit{ value: msg.value }();

    address[] memory tokens = pipt.getCurrentTokens();
    return _swapWethToPiptByPoolOut(msg.value, _poolAmountOut, tokens, getWrapFee(tokens));
  }

  function swapPiptToEth(uint256 _poolAmountIn) external payable returns (uint256 ethOutAmount) {
    ethOutAmount = _swapPiptToWeth(_poolAmountIn);

    weth.withdraw(ethOutAmount);
    msg.sender.transfer(ethOutAmount);
  }

  function convertOddToCvpAndSendToPayout(address[] memory oddTokens) external {
    require(msg.sender == tx.origin && !Address.isContract(msg.sender), "CONTRACT_NOT_ALLOWED");

    uint256 len = oddTokens.length;

    for (uint256 i = 0; i < len; i++) {
      uint256 tokenBalance = TokenInterface(oddTokens[i]).balanceOf(address(this));
      IUniswapV2Pair tokenPair = _uniswapPairFor(oddTokens[i]);

      (uint256 tokenReserve, uint256 ethReserve, ) = tokenPair.getReserves();
      uint256 wethOut = UniswapV2Library.getAmountOut(tokenBalance, tokenReserve, ethReserve);

      TokenInterface(oddTokens[i]).safeTransfer(address(tokenPair), tokenBalance);

      tokenPair.swap(uint256(0), wethOut, address(this), new bytes(0));
    }

    uint256 wethBalance = weth.balanceOf(address(this));

    IUniswapV2Pair cvpPair = _uniswapPairFor(address(cvp));

    (uint256 cvpReserve, uint256 ethReserve, ) = cvpPair.getReserves();
    uint256 cvpOut = UniswapV2Library.getAmountOut(wethBalance, ethReserve, cvpReserve);

    weth.safeTransfer(address(cvpPair), wethBalance);

    cvpPair.swap(cvpOut, uint256(0), address(this), new bytes(0));

    cvp.safeTransfer(feePayout, cvpOut);

    emit PayoutCVP(feePayout, wethBalance, cvpOut);
  }

  function setFees(
    uint256[] calldata _feeLevels,
    uint256[] calldata _feeAmounts,
    address _feePayout,
    address _feeManager
  ) external onlyFeeManagerOrOwner {
    feeLevels = _feeLevels;
    feeAmounts = _feeAmounts;
    feePayout = _feePayout;
    feeManager = _feeManager;

    emit SetFees(msg.sender, _feeLevels, _feeAmounts, _feePayout, _feeManager);
  }

  function setTokensSettings(
    address[] memory _tokens,
    address[] memory _pairs,
    bool[] memory _reapprove
  ) external onlyOwner {
    uint256 len = _tokens.length;
    require(len == _pairs.length && len == _reapprove.length, "LENGTHS_NOT_EQUAL");
    for (uint256 i = 0; i < len; i++) {
      uniswapEthPairByTokenAddress[_tokens[i]] = _pairs[i];
      uniswapEthPairToken0[_pairs[i]] = IUniswapV2Pair(_pairs[i]).token0();
      reApproveTokens[_tokens[i]] = _reapprove[i];
      emit SetTokenSetting(_tokens[i], _reapprove[i], _pairs[i]);
    }
  }

  function fetchUnswapPairsFromFactory(address _factory, address[] calldata _tokens) external onlyOwner {
    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      address pair = IUniswapV2Factory(_factory).getPair(_tokens[i], address(weth));
      uniswapEthPairByTokenAddress[_tokens[i]] = pair;
      uniswapEthPairToken0[pair] = IUniswapV2Pair(pair).token0();
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
      // poolOut by 1 ether first token join = piptTotalSupply.mul(1 ether).div(pipt.getBalance(_tokens[0]))
      // poolRatio = poolOut/totalSupply
      uint256 poolRatio =
        piptTotalSupply.mul(1 ether).div(pipt.getBalance(_tokens[0])).mul(1 ether).div(piptTotalSupply);

      for (uint256 i = 0; i < _tokens.length; i++) {
        // token share relatively 1 ether of first token
        calculations[i].tokenAmount = poolRatio.mul(pipt.getBalance(_tokens[i])).div(1 ether);

        (calculations[i].tokenReserve, calculations[i].ethReserve, ) = _uniswapPairFor(_tokens[i]).getReserves();
        calculations[i].ethAmount = UniswapV2Library.getAmountIn(
          calculations[i].tokenAmount,
          calculations[i].ethReserve,
          calculations[i].tokenReserve
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

    poolOut = pipt.totalSupply().mul(tokensInPipt[0]).div(pipt.getBalance(_tokens[0]));
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
      tokensOutPipt[i] = poolRatio.mul(pipt.getBalance(_tokens[i])).div(1 ether);

      (uint256 tokenReserve, uint256 ethReserve, ) = _uniswapPairFor(_tokens[i]).getReserves();
      ethOutUniswap[i] = UniswapV2Library.getAmountOut(tokensOutPipt[i], tokenReserve, ethReserve);
      totalEthOut = totalEthOut.add(ethOutUniswap[i]);
    }
  }

  function calcNeedEthToPoolOut(uint256 _poolAmountOut, uint256 _slippage) public view returns (uint256) {
    uint256 ratio = _poolAmountOut.mul(1 ether).div(pipt.totalSupply()).add(10);

    address[] memory tokens = pipt.getCurrentTokens();
    uint256 len = tokens.length;

    CalculationStruct[] memory calculations = new CalculationStruct[](len);
    uint256[] memory tokensInPipt = new uint256[](len);

    uint256 totalEthSwap = 0;
    for (uint256 i = 0; i < len; i++) {
      IUniswapV2Pair tokenPair = _uniswapPairFor(tokens[i]);

      (calculations[i].tokenReserve, calculations[i].ethReserve, ) = tokenPair.getReserves();
      tokensInPipt[i] = ratio.mul(pipt.getBalance(tokens[i])).div(1 ether);
      totalEthSwap = UniswapV2Library
        .getAmountIn(tokensInPipt[i], calculations[i].ethReserve, calculations[i].tokenReserve)
        .add(totalEthSwap);
    }
    return totalEthSwap.add(totalEthSwap.mul(_slippage).div(1 ether));
  }

  function calcEthFee(
    uint256 ethAmount,
    uint256 wrapperFee
  ) public view returns (uint256 ethFee, uint256 ethAfterFee) {
    ethFee = wrapperFee;
    uint256 len = feeLevels.length;
    for (uint256 i = 0; i < len; i++) {
      if (ethAmount >= feeLevels[i]) {
        ethFee = ethAmount.mul(feeAmounts[i]).div(1 ether);
        break;
      }
    }
    ethAfterFee = ethAmount.sub(ethFee);
  }

  function calcEthFee(uint256 ethAmount) external view returns (uint256 ethFee, uint256 ethAfterFee) {
    (ethFee, ethAfterFee) = calcEthFee(ethAmount, getWrapFee(pipt.getCurrentTokens()));
  }

  function getFeeLevels() external view returns (uint256[] memory) {
    return feeLevels;
  }

  function getFeeAmounts() external view returns (uint256[] memory) {
    return feeAmounts;
  }

  function getWrapFee(address[] memory tokens) public view returns (uint256 wrapperFee) {
    if (address(piptWrapper) != address(0)) {
      wrapperFee = piptWrapper.calcEthFeeForTokens(tokens);
    }
  }

  function _uniswapPairFor(address token) internal view returns (IUniswapV2Pair) {
    return IUniswapV2Pair(uniswapEthPairByTokenAddress[token]);
  }

  function _swapWethToPiptByPoolOut(
    uint256 _wethAmount,
    uint256 _poolAmountOut,
    address[] memory tokens,
    uint256 wrapperFee
  )
    internal
    returns (uint256 poolAmountOutAfterFee, uint256 oddEth)
  {
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
    pipt.safeTransfer(msg.sender, poolAmountOutAfterFee);

    oddEth = swapAmount.sub(totalEthSwap);
    if (oddEth > 0) {
      weth.withdraw(oddEth);
      msg.sender.transfer(oddEth);
      emit OddEth(msg.sender, oddEth);
    }
  }

  function _prepareTokensForJoin(address[] memory _tokens, uint256 _poolAmountOut)
    internal
    returns (uint256[] memory tokensInPipt, uint256 totalEthSwap)
  {
    uint256 len = _tokens.length;
    tokensInPipt = new uint256[](len);
    uint256 ratio = _poolAmountOut.mul(1 ether).div(pipt.totalSupply()).add(10);
    CalculationStruct[] memory calculations = new CalculationStruct[](len);
    for (uint256 i = 0; i < len; i++) {
      IUniswapV2Pair tokenPair = _uniswapPairFor(_tokens[i]);

      (calculations[i].tokenReserve, calculations[i].ethReserve, ) = tokenPair.getReserves();
      tokensInPipt[i] = ratio.mul(pipt.getBalance(_tokens[i])).div(1 ether);
      calculations[i].ethAmount = UniswapV2Library.getAmountIn(
        tokensInPipt[i],
        calculations[i].ethReserve,
        calculations[i].tokenReserve
      );

      weth.safeTransfer(address(tokenPair), calculations[i].ethAmount);

      tokenPair.swap(tokensInPipt[i], uint256(0), address(this), new bytes(0));
      totalEthSwap = totalEthSwap.add(calculations[i].ethAmount);

      if (reApproveTokens[_tokens[i]]) {
        TokenInterface(_tokens[i]).approve(address(pipt), 0);
      }

      TokenInterface(_tokens[i]).approve(address(pipt), tokensInPipt[i]);
    }
  }

  function _swapPiptToWeth(uint256 _poolAmountIn) internal returns (uint256) {
    address[] memory tokens = pipt.getCurrentTokens();
    uint256 len = tokens.length;

    (uint256[] memory tokensOutPipt, uint256[] memory ethOutUniswap, uint256 totalEthOut, uint256 poolAmountFee) =
      calcSwapPiptToEthInputs(_poolAmountIn, tokens);

    pipt.safeTransferFrom(msg.sender, address(this), _poolAmountIn);

    pipt.approve(address(pipt), _poolAmountIn);

    uint256 wrapperFee = getWrapFee(tokens);

    (uint256 ethFeeAmount, uint256 ethOutAmount) = calcEthFee(totalEthOut, wrapperFee);

    _exitPool(_poolAmountIn, tokensOutPipt, wrapperFee);

    for (uint256 i = 0; i < len; i++) {
      IUniswapV2Pair tokenPair = _uniswapPairFor(tokens[i]);
      TokenInterface(tokens[i]).safeTransfer(address(tokenPair), tokensOutPipt[i]);
      tokenPair.swap(uint256(0), ethOutUniswap[i], address(this), new bytes(0));
    }


    emit PiptToEthSwap(msg.sender, _poolAmountIn, poolAmountFee, ethOutAmount, ethFeeAmount);

    return ethOutAmount;
  }

  function _joinPool(uint256 _poolAmountOut, uint256[] memory _maxAmountsIn, uint256 _wrapperFee) internal {
    if (address(piptWrapper) == address(0)) {
      pipt.joinPool(_poolAmountOut, _maxAmountsIn);
    } else {
      if (address(this).balance < _wrapperFee) {
        weth.withdraw(_wrapperFee);
      }
      piptWrapper.joinPool{ value: _wrapperFee }(_poolAmountOut, _maxAmountsIn);
    }
  }

  function _exitPool(uint256 _poolAmountIn, uint256[] memory _minAmountsOut, uint256 _wrapperFee) internal {
    if (address(piptWrapper) == address(0)) {
      pipt.exitPool(_poolAmountIn, _minAmountsOut);
    } else {
      piptWrapper.exitPool{ value: _wrapperFee }(_poolAmountIn, _minAmountsOut);
    }
  }
}
