// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@powerpool/power-oracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/TokenInterface.sol";
import "../interfaces/BPoolInterface.sol";
import "../powerindex-router/PowerIndexWrapper.sol";
import "../balancer-core/BMath.sol";
import "./CVPMakerStorage.sol";
import "./CVPMakerViewer.sol";

contract CVPMaker is OwnableUpgradeSafe, CVPMakerStorage, CVPMakerViewer {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  /// @notice The event emitted when the owner updates the powerOracleStaking address
  event SetPowerPoke(address powerPoke);
  event Swap(
    address indexed caller,
    address indexed token,
    uint256 indexed swapType,
    uint256 amountIn,
    uint256 amountOut,
    uint256 xcvpCvpBefore,
    uint256 xcvpCvpAfter
  );
  event SetCvpAmountOut(uint256 cvpAmountOut);
  event SetCustomPath(address indexed token_, address router_, address[] path);
  event SetCustomStrategy(address indexed token, uint256 strategyId);

  modifier onlyEOA() {
    require(msg.sender == tx.origin, "NOT_EOA");
    _;
  }

  modifier onlyReporter(uint256 reporterId_, bytes calldata rewardOpts_) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeReporter(reporterId_, msg.sender);
    _;
    powerPoke.reward(reporterId_, gasStart.sub(gasleft()), COMPENSATION_PLAN_1_ID, rewardOpts_);
  }

  modifier onlySlasher(uint256 slasherId_, bytes calldata rewardOpts_) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeNonReporter(slasherId_, msg.sender);
    _;
    powerPoke.reward(slasherId_, gasStart.sub(gasleft()), COMPENSATION_PLAN_1_ID, rewardOpts_);
  }

  constructor(
    address cvp_,
    address xcvp_,
    address weth_,
    address uniswapRouter_,
    address restrictions_
  ) public CVPMakerViewer(cvp_, xcvp_, weth_, uniswapRouter_, restrictions_) {}

  receive() external payable {}

  function initialize(address powerPoke_, uint256 cvpAmountOut_) external initializer {
    require(cvpAmountOut_ > 0, "CVP_AMOUNT_OUT_0");

    powerPoke = IPowerPoke(powerPoke_);
    cvpAmountOut = cvpAmountOut_;

    emit SetPowerPoke(powerPoke_);
    emit SetCvpAmountOut(cvpAmountOut_);

    __Ownable_init();
  }

  function skipFromReporter(uint256 reporterId_, bytes calldata rewardOpts_)
    external
    onlyEOA
    onlyReporter(reporterId_, rewardOpts_)
  {
    (uint256 minInterval, ) = _getMinMaxReportInterval();
    require(block.timestamp.sub(lastReporterPokeFrom) > minInterval, "MIN_INTERVAL_NOT_REACHED");
    lastReporterPokeFrom = block.timestamp;
  }

  function swapFromReporter(
    uint256 reporterId_,
    address token_,
    bytes calldata rewardOpts_
  ) external onlyEOA onlyReporter(reporterId_, rewardOpts_) {
    (uint256 minInterval, ) = _getMinMaxReportInterval();
    require(block.timestamp.sub(lastReporterPokeFrom) > minInterval, "MIN_INTERVAL_NOT_REACHED");
    _swap(token_);
  }

  function swapFromSlasher(
    uint256 slasherId_,
    address token_,
    bytes calldata rewardOpts_
  ) external onlyEOA onlySlasher(slasherId_, rewardOpts_) {
    (, uint256 maxInterval) = _getMinMaxReportInterval();
    require(block.timestamp.sub(lastReporterPokeFrom) > maxInterval, "MAX_INTERVAL_NOT_REACHED");
    _swap(token_);
  }

  /*** SWAP HELPERS ***/

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    return powerPoke.getMinMaxReportIntervals(address(this));
  }

  function _swap(address token_) internal {
    uint256 cvpBefore = IERC20(cvp).balanceOf(xcvp);
    lastReporterPokeFrom = block.timestamp;
    uint256 cvpAmountOut_ = cvpAmountOut;
    uint256 swapType = 0;
    uint256 amountIn = 0;

    // Just transfer CVPs to xCVP contract
    if (token_ == cvp) {
      swapType = 1;
      IERC20(cvp).transfer(xcvp, cvpAmountOut_);
      amountIn = cvpAmountOut_;
    } else if (token_ == weth || token_ == ETH) {
      // Wrap ETH -> WETH
      if (token_ == ETH) {
        amountIn = address(this).balance;
        require(amountIn > 0, "ETH_BALANCE_IS_0");
        TokenInterface(weth).deposit{ value: amountIn }();
      }

      // Use a single pair path to swap WETH -> CVP
      amountIn = _swapWETHToCVP();
      swapType = 2;
    } else {
      uint256 customStrategyId = customStrategies[token_];
      if (customStrategyId > 0) {
        amountIn = _executeCustomStrategy(token_, customStrategyId);
        swapType = 3;
        // Use a Uniswap-like strategy
      } else {
        amountIn = _executeUniLikeStrategy(token_);
        swapType = 4;
      }
    }
    uint256 cvpAfter = IERC20(cvp).balanceOf(xcvp);
    require(cvpAfter >= cvpBefore.add((cvpAmountOut_ * 99) / 100), "LESS_THAN_CVP_AMOUNT_OUT");

    emit Swap(msg.sender, token_, swapType, amountIn, cvpAmountOut_, cvpBefore, cvpAfter);
  }

  function _executeUniLikeStrategy(address token_) internal returns (uint256 amountOut) {
    address router = getRouter(token_);
    address[] memory path = getPath(token_);

    if (router == uniswapRouter) {
      amountOut = _swapTokensForExactCVP(router, token_, path);
    } else {
      uint256 wethAmountIn = estimateEthStrategyIn();
      amountOut = _swapTokensForExactWETH(router, token_, path, wethAmountIn);
      _swapWETHToCVP();
    }
  }

  function _swapTokensForExactWETH(
    address router_,
    address token_,
    address[] memory path_,
    uint256 amountOut_
  ) internal returns (uint256 amountIn) {
    IERC20(token_).approve(router_, type(uint256).max);
    uint256[] memory amounts =
      IUniswapV2Router02(router_).swapTokensForExactTokens(
        amountOut_,
        type(uint256).max,
        path_,
        address(this),
        block.timestamp + 1800
      );
    IERC20(token_).approve(router_, 0);
    return amounts[0];
  }

  function _swapWETHToCVP() internal returns (uint256) {
    address[] memory path = new address[](2);

    path[0] = weth;
    path[1] = cvp;
    IERC20(weth).approve(uniswapRouter, type(uint256).max);
    uint256[] memory amounts =
      IUniswapV2Router02(uniswapRouter).swapTokensForExactTokens(
        cvpAmountOut,
        type(uint256).max,
        path,
        xcvp,
        block.timestamp + 1800
      );
    IERC20(weth).approve(uniswapRouter, 0);
    return amounts[0];
  }

  function _swapTokensForExactCVP(
    address router_,
    address token_,
    address[] memory path_
  ) internal returns (uint256) {
    IERC20(token_).approve(router_, type(uint256).max);
    uint256[] memory amounts =
      IUniswapV2Router02(router_).swapTokensForExactTokens(
        cvpAmountOut,
        type(uint256).max,
        path_,
        xcvp,
        block.timestamp + 1800
      );
    IERC20(token_).approve(router_, 0);
    return amounts[0];
  }

  function _executeCustomStrategy(address token_, uint256 strategyId_) internal returns (uint256 amountIn) {
    if (strategyId_ == 1) {
      return _customStrategy1(token_);
    } else if (strategyId_ == 2) {
      return _customStrategy2(token_);
    } else if (strategyId_ == 3) {
      return _customStrategy3(token_);
    } else {
      revert("INVALID_STRATEGY_ID");
    }
  }

  /*** CUSTOM STRATEGIES ***/

  // Pool tokens with CVP - PIPT & YETI - like
  function _customStrategy1(address bPoolToken_) internal returns (uint256 amountIn) {
    uint256 cvpAmountOut_ = cvpAmountOut;
    Strategy1Config storage config = strategy1Config[bPoolToken_];
    address iBPool = bPoolToken_;

    if (config.bPool != address(0)) {
      iBPool = config.bPool;
    }

    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    uint256 amountOutGross = calcBPoolGrossAmount(cvpAmountOut_, communityExitFee);

    uint256 currentBalance = IERC20(bPoolToken_).balanceOf(address(this));
    IERC20(bPoolToken_).approve(iBPool, currentBalance);
    amountIn = BPoolInterface(iBPool).exitswapExternAmountOut(cvp, amountOutGross, currentBalance);
    IERC20(bPoolToken_).approve(iBPool, 0);

    IERC20(cvp).transfer(xcvp, cvpAmountOut_);
  }

  // Pool tokens without CVP - ASSY-like
  function _customStrategy2(address bPoolToken_) internal returns (uint256 amountIn) {
    Strategy2Config storage config = strategy2Config[bPoolToken_];
    uint256 nextIndex = config.nextIndex;
    address underlyingOrPiToExit = config.tokens[nextIndex];
    require(underlyingOrPiToExit != address(0), "INVALID_EXIT_TOKEN");

    address underlyingToken = underlyingOrPiToExit;
    if (nextIndex + 1 >= config.tokens.length) {
      config.nextIndex = 0;
    } else {
      config.nextIndex = nextIndex + 1;
    }

    address iBPool = bPoolToken_;

    if (config.bPool != address(0)) {
      iBPool = config.bPool;
      address underlyingCandidate = PowerIndexWrapper(config.bPool).underlyingByPiToken(underlyingOrPiToExit);
      if (underlyingCandidate != address(0)) {
        underlyingToken = underlyingCandidate;
      }
    }

    uint256 tokenAmountUniIn = estimateUniLikeStrategyIn(underlyingToken);
    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    uint256 amountOutGross = calcBPoolGrossAmount(tokenAmountUniIn, communityExitFee);

    uint256 currentBalance = IERC20(bPoolToken_).balanceOf(address(this));
    IERC20(bPoolToken_).approve(iBPool, currentBalance);
    amountIn = BPoolInterface(iBPool).exitswapExternAmountOut(underlyingToken, amountOutGross, currentBalance);
    IERC20(bPoolToken_).approve(iBPool, 0);

    _executeUniLikeStrategy(underlyingToken);
  }

  // Tokens available for swap on PowerPool pools
  function _customStrategy3(address token_) internal returns (uint256 amountIn) {
    Strategy3Config storage config = strategy3Config[token_];
    BPoolInterface bPool = BPoolInterface(config.bPool);

    (uint256 communitySwapFee, , , ) = bPool.getCommunityFee();
    uint256 cvpAmountOut_ = cvpAmountOut;
    uint256 amountOutGross = calcBPoolGrossAmount(cvpAmountOut_, communitySwapFee);

    IERC20(token_).approve(address(bPool), type(uint256).max);
    (amountIn, ) = bPool.swapExactAmountOut(token_, type(uint256).max, cvp, amountOutGross, type(uint256).max);
    IERC20(token_).approve(address(bPool), 0);

    IERC20(cvp).transfer(xcvp, cvpAmountOut_);
  }

  /*** PERMISSIONLESS METHODS ***/

  function syncStrategy2Tokens(address token_) external {
    require(customStrategies[token_] == 2, "CUSTOM_STRATEGY_2_FORBIDDEN");

    Strategy2Config storage config = strategy2Config[token_];
    address[] memory newTokens = BPoolInterface(token_).getCurrentTokens();
    require(newTokens.length > 0, "NEW_LENGTH_IS_0");
    config.tokens = newTokens;
    if (config.nextIndex >= newTokens.length) {
      config.nextIndex = 0;
    }
  }

  /*** OWNER METHODS ***/

  function setCvpAmountOut(uint256 cvpAmountOut_) external onlyOwner {
    require(cvpAmountOut_ > 0, "CVP_AMOUNT_OUT_0");
    cvpAmountOut = cvpAmountOut_;
    emit SetCvpAmountOut(cvpAmountOut_);
  }

  function setCustomStrategy(address token_, uint256 strategyId_) external onlyOwner {
    customStrategies[token_] = strategyId_;
    emit SetCustomStrategy(token_, strategyId_);
  }

  function setCustomStrategy1Config(address token_, address bPool_) external onlyOwner {
    strategy1Config[token_].bPool = bPool_;
  }

  function setCustomStrategy2Config(address token_, address bPool_) external onlyOwner {
    strategy2Config[token_].bPool = bPool_;
  }

  function setCustomStrategy3Config(address token_, address bPool_) external onlyOwner {
    strategy3Config[token_] = Strategy3Config(bPool_);
  }

  function setCustomPath(
    address token_,
    address router_,
    address[] calldata customPath_
  ) external onlyOwner {
    if (router_ == uniswapRouter) {
      require(customPath_.length == 0 || customPath_[customPath_.length - 1] == cvp, "NON_CVP_END_ON_UNISWAP_PATH");
    } else {
      require(customPath_[customPath_.length - 1] == weth, "NON_WETH_END_ON_NON_UNISWAP_PATH");
    }

    routers[token_] = router_;
    customPaths[token_] = customPath_;

    emit SetCustomPath(token_, router_, customPath_);
  }
}
