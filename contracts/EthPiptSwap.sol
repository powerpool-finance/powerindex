// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/BPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./interfaces/IPoolRestrictions.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./lib/UniswapV2Library.sol";

contract EthPiptSwap is Ownable {
  using SafeMath for uint256;
  using SafeERC20 for TokenInterface;

  TokenInterface public weth;
  TokenInterface public cvp;
  BPoolInterface public pipt;

  uint256[] public feeLevels;
  uint256[] public feeAmounts;
  address public feePayout;
  address public feeManager;

  mapping(address => address) public uniswapEthPairByTokenAddress;
  mapping(address => bool) public reApproveTokens;
  uint256 public defaultSlippage;

  struct CalculationStruct {
    uint256 tokenAmount;
    uint256 ethAmount;
    uint256 tokenReserve;
    uint256 ethReserve;
  }

  event SetTokenSetting(address indexed token, bool reApprove, address uniswapPair);
  event SetDefaultSlippage(uint256 newDefaultSlippage);
  event SetFees(
    address indexed sender,
    uint256[] newFeeLevels,
    uint256[] newFeeAmounts,
    address indexed feePayout,
    address indexed feeManager
  );

  event EthToPiptSwap(
    address indexed user,
    uint256 ethSwapAmount,
    uint256 ethFeeAmount,
    uint256 piptAmount,
    uint256 piptCommunityFee
  );
  event OddEth(address indexed user, uint256 amount);
  event PiptToEthSwap(
    address indexed user,
    uint256 piptSwapAmount,
    uint256 piptCommunityFee,
    uint256 ethOutAmount,
    uint256 ethFeeAmount
  );
  event PayoutCVP(address indexed receiver, uint256 wethAmount, uint256 cvpAmount);

  constructor(
    address _weth,
    address _cvp,
    address _pipt,
    address _feeManager
  ) public Ownable() {
    weth = TokenInterface(_weth);
    cvp = TokenInterface(_cvp);
    pipt = BPoolInterface(_pipt);
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

  function swapEthToPipt(uint256 _slippage) public payable {
    (, uint256 swapAmount) = calcEthFee(msg.value);

    address[] memory tokens = pipt.getCurrentTokens();

    (, , uint256 poolAmountOut) = calcSwapEthToPiptInputs(swapAmount, tokens, _slippage);

    swapEthToPiptByPoolOut(poolAmountOut);
  }

  function swapEthToPiptByPoolOut(uint256 _poolAmountOut) public payable {
    {
      address poolRestrictions = pipt.getRestrictions();
      if (address(poolRestrictions) != address(0)) {
        uint256 maxTotalSupply = IPoolRestrictions(poolRestrictions).getMaxTotalSupply(address(pipt));
        require(pipt.totalSupply().add(_poolAmountOut) <= maxTotalSupply, "PIPT_MAX_SUPPLY");
      }
    }

    require(msg.value > 0, "ETH required");
    weth.deposit.value(msg.value)();

    (uint256 feeAmount, uint256 swapAmount) = calcEthFee(msg.value);

    uint256 ratio = _poolAmountOut.mul(1 ether).div(pipt.totalSupply()).add(10);

    address[] memory tokens = pipt.getCurrentTokens();
    uint256 len = tokens.length;

    CalculationStruct[] memory calculations = new CalculationStruct[](tokens.length);
    uint256[] memory tokensInPipt = new uint256[](tokens.length);

    uint256 totalEthSwap = 0;
    for (uint256 i = 0; i < len; i++) {
      IUniswapV2Pair tokenPair = uniswapPairFor(tokens[i]);

      (calculations[i].tokenReserve, calculations[i].ethReserve, ) = tokenPair.getReserves();
      tokensInPipt[i] = ratio.mul(pipt.getBalance(tokens[i])).div(1 ether);
      calculations[i].ethAmount = UniswapV2Library.getAmountIn(
        tokensInPipt[i],
        calculations[i].ethReserve,
        calculations[i].tokenReserve
      );

      weth.transfer(address(tokenPair), calculations[i].ethAmount);

      tokenPair.swap(tokensInPipt[i], uint256(0), address(this), new bytes(0));
      totalEthSwap = totalEthSwap.add(calculations[i].ethAmount);

      if (reApproveTokens[tokens[i]]) {
        TokenInterface(tokens[i]).approve(address(pipt), 0);
      }

      TokenInterface(tokens[i]).approve(address(pipt), tokensInPipt[i]);
    }

    (, uint256 communityJoinFee, , ) = pipt.getCommunityFee();
    (uint256 poolAmountOutAfterFee, uint256 poolAmountOutFee) =
      pipt.calcAmountWithCommunityFee(_poolAmountOut, communityJoinFee, address(this));

    emit EthToPiptSwap(msg.sender, swapAmount, feeAmount, _poolAmountOut, poolAmountOutFee);

    pipt.joinPool(_poolAmountOut, tokensInPipt);
    pipt.transfer(msg.sender, poolAmountOutAfterFee);

    uint256 ethDiff = swapAmount.sub(totalEthSwap);
    if (ethDiff > 0) {
      weth.withdraw(ethDiff);
      msg.sender.transfer(ethDiff);
      emit OddEth(msg.sender, ethDiff);
    }
  }

  function swapPiptToEth(uint256 _poolAmountIn) public {
    address[] memory tokens = pipt.getCurrentTokens();
    uint256 len = tokens.length;

    (uint256[] memory tokensOutPipt, uint256[] memory ethOutUniswap, uint256 totalEthOut, uint256 poolAmountFee) =
      calcSwapPiptToEthInputs(_poolAmountIn, tokens);

    pipt.transferFrom(msg.sender, address(this), _poolAmountIn);

    pipt.approve(address(pipt), _poolAmountIn);

    pipt.exitPool(_poolAmountIn, tokensOutPipt);

    for (uint256 i = 0; i < len; i++) {
      IUniswapV2Pair tokenPair = uniswapPairFor(tokens[i]);
      TokenInterface(tokens[i]).transfer(address(tokenPair), tokensOutPipt[i]);
      tokenPair.swap(uint256(0), ethOutUniswap[i], address(this), new bytes(0));
    }

    (uint256 ethFeeAmount, uint256 ethOutAmount) = calcEthFee(totalEthOut);

    weth.withdraw(ethOutAmount);
    msg.sender.transfer(ethOutAmount);

    emit PiptToEthSwap(msg.sender, _poolAmountIn, poolAmountFee, ethOutAmount, ethFeeAmount);
  }

  function convertOddToCvpAndSendToPayout(address[] memory oddTokens) public {
    require(msg.sender == tx.origin && !Address.isContract(msg.sender), "Call from contract not allowed");

    uint256 len = oddTokens.length;

    for (uint256 i = 0; i < len; i++) {
      uint256 tokenBalance = TokenInterface(oddTokens[i]).balanceOf(address(this));
      IUniswapV2Pair tokenPair = uniswapPairFor(oddTokens[i]);

      (uint256 tokenReserve, uint256 ethReserve, ) = tokenPair.getReserves();
      uint256 wethOut = UniswapV2Library.getAmountOut(tokenBalance, tokenReserve, ethReserve);

      TokenInterface(oddTokens[i]).transfer(address(tokenPair), tokenBalance);

      tokenPair.swap(uint256(0), wethOut, address(this), new bytes(0));
    }

    uint256 wethBalance = weth.balanceOf(address(this));

    IUniswapV2Pair cvpPair = uniswapPairFor(address(cvp));

    (uint256 cvpReserve, uint256 ethReserve, ) = cvpPair.getReserves();
    uint256 cvpOut = UniswapV2Library.getAmountOut(wethBalance, ethReserve, cvpReserve);

    weth.transfer(address(cvpPair), wethBalance);

    cvpPair.swap(cvpOut, uint256(0), address(this), new bytes(0));

    cvp.transfer(feePayout, cvpOut);

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
    require(len == _pairs.length && len == _reapprove.length, "Lengths are not equal");
    for (uint256 i = 0; i < _tokens.length; i++) {
      uniswapEthPairByTokenAddress[_tokens[i]] = _pairs[i];
      reApproveTokens[_tokens[i]] = _reapprove[i];
      emit SetTokenSetting(_tokens[i], _reapprove[i], _pairs[i]);
    }
  }

  function setDefaultSlippage(uint256 _defaultSlippage) external onlyOwner {
    defaultSlippage = _defaultSlippage;
    emit SetDefaultSlippage(_defaultSlippage);
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

        (calculations[i].tokenReserve, calculations[i].ethReserve, ) = uniswapPairFor(_tokens[i]).getReserves();
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

      (uint256 tokenReserve, uint256 ethReserve, ) = uniswapPairFor(_tokens[i]).getReserves();
      ethOutUniswap[i] = UniswapV2Library.getAmountOut(tokensOutPipt[i], tokenReserve, ethReserve);
      totalEthOut = totalEthOut.add(ethOutUniswap[i]);
    }
  }

  function calcEthFee(uint256 ethValue) public view returns (uint256 ethFee, uint256 ethAfterFee) {
    ethFee = 0;
    uint256 len = feeLevels.length;
    for (uint256 i = 0; i < len; i++) {
      if (ethValue >= feeLevels[i]) {
        ethFee = ethValue.mul(feeAmounts[i]).div(1 ether);
        break;
      }
    }
    ethAfterFee = ethValue.sub(ethFee);
  }

  function getFeeLevels() public view returns (uint256[] memory) {
    return feeLevels;
  }

  function getFeeAmounts() public view returns (uint256[] memory) {
    return feeAmounts;
  }

  function uniswapPairFor(address token) internal view returns (IUniswapV2Pair) {
    return IUniswapV2Pair(uniswapEthPairByTokenAddress[token]);
  }
}
