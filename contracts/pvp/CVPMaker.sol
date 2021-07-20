// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@powerpool/power-oracle/contracts/interfaces/IPowerPoke.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/TokenInterface.sol";
import "../interfaces/BPoolInterface.sol";
import "../interfaces/ICVPMakerStrategy.sol";
import "../powerindex-router/PowerIndexWrapper.sol";
import "./CVPMakerStorage.sol";
import "./CVPMakerViewer.sol";

contract CVPMaker is OwnableUpgradeSafe, CVPMakerStorage, CVPMakerViewer {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  /// @notice The event emitted when the owner updates the powerOracleStaking address
  event SetPowerPoke(address powerPoke);
  /// @notice The event emitted when a poker calls swapFromReporter to convert token to CVP
  event Swap(
    address indexed caller,
    address indexed token,
    uint256 indexed swapType,
    uint256 amountIn,
    uint256 amountOut,
    uint256 xcvpCvpBefore,
    uint256 xcvpCvpAfter
  );
  /// @notice The event emitted when the owner updates cvpAmountOut value
  event SetPoolRestrictions(address poolRestrictions);
  /// @notice The event emitted when the owner updates cvpAmountOut value
  event SetCvpAmountOut(uint256 cvpAmountOut);
  /// @notice The event emitted when the owner updates a token custom uni-like path
  event SetCustomPath(address indexed token_, address router_, address[] path);
  /// @notice The event emitted when the owner assigns a custom strategy for the token
  event SetCustomStrategy(address indexed token, uint256 strategyId);
  /// @notice The event emitted when the owner configures an external strategy for the token
  event SetExternalStrategy(address indexed token_, address indexed strategy, bool maxAmountIn);

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
    address uniswapRouter_
  ) public CVPMakerViewer(cvp_, xcvp_, weth_, uniswapRouter_) {}

  receive() external payable {}

  function initialize(
    address powerPoke_,
    address restrictions_,
    uint256 cvpAmountOut_
  ) external initializer {
    require(cvpAmountOut_ > 0, "CVP_AMOUNT_OUT_0");

    powerPoke = IPowerPoke(powerPoke_);
    restrictions = IPoolRestrictions(restrictions_);
    cvpAmountOut = cvpAmountOut_;

    emit SetPowerPoke(powerPoke_);
    emit SetCvpAmountOut(cvpAmountOut_);

    __Ownable_init();
  }

  /**
   * @notice The swap call from the reporter
   * @param reporterId_ The current reporter id
   * @param token_ The token to swap to CVP
   * @param rewardOpts_ Custom settings for the reporter reward
   */
  function swapFromReporter(
    uint256 reporterId_,
    address token_,
    bytes calldata rewardOpts_
  ) external onlyEOA onlyReporter(reporterId_, rewardOpts_) {
    (uint256 minInterval, ) = _getMinMaxReportInterval();
    require(block.timestamp.sub(lastReporterPokeFrom) > minInterval, "MIN_INTERVAL_NOT_REACHED");
    _swap(token_);
  }

  /**
   * @notice The swap call from a slasher in case if the reporter has missed his call
   * @param slasherId_ The current slasher id
   * @param token_ The token to swap to CVP
   * @param rewardOpts_ Custom settings for the slasher reward
   */
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
        return;
      }

      if (externalStrategiesConfig[token_].strategy != address(0)) {
        amountIn = _executeExternalStrategy(token_);
        swapType = 4;
        return;
      }

      // Use a Uniswap-like strategy
      amountIn = _executeUniLikeStrategy(token_);
      swapType = 5;
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

  function _executeExternalStrategy(address token_) internal returns (uint256 amountIn) {
    ExternalStrategiesConfig storage config = externalStrategiesConfig[token_];
    address executeUniLikeFrom;
    address executeContract;
    bytes memory executeData;

    if (config.maxAmountIn) {
      amountIn = IERC20(token_).balanceOf(address(this));
      uint256 strategyAmountOut = ICVPMakerStrategy(config.strategy).estimateOut(token_, amountIn, config.config);
      uint256 resultCvpOut =
        estimateUniLikeStrategyOut(ICVPMakerStrategy(config.strategy).getTokenOut(), strategyAmountOut);
      require(resultCvpOut >= cvpAmountOut, "INSUFFICIENT_CVP_AMOUNT_OUT");

      (executeUniLikeFrom, executeData, executeContract) = ICVPMakerStrategy(config.strategy).getExecuteDataByAmountIn(
        token_,
        amountIn,
        externalStrategiesConfig[token_].config
      );
    } else {
      (amountIn, executeUniLikeFrom, executeData, executeContract) = ICVPMakerStrategy(config.strategy)
        .getExecuteDataByAmountOut(
        token_,
        estimateUniLikeStrategyIn(ICVPMakerStrategy(config.strategy).getTokenOut()),
        externalStrategiesConfig[token_].config
      );
    }

    IERC20(token_).approve(executeContract, amountIn);
    (bool success, bytes memory data) = executeContract.call(executeData);
    require(success, "NOT_SUCCESS");

    if (executeUniLikeFrom != address(0)) {
      _executeUniLikeStrategy(executeUniLikeFrom);
    }
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

  /**
   * @notice The Strategy 1 exits a PowerIndex pool to CVP token. The pool should have CVP token bound.
   * (For PIPT & YETI - like pools)
   * @param bPoolToken_ PowerIndex Pool Token
   * @return amountIn The amount of bPoolToken_ used as an input for the swap
   */
  function _customStrategy1(address bPoolToken_) internal returns (uint256 amountIn) {
    uint256 cvpAmountOut_ = cvpAmountOut;
    Strategy1Config memory config = strategy1Config[bPoolToken_];
    address iBPool = bPoolToken_;

    if (config.bPoolWrapper != address(0)) {
      iBPool = config.bPoolWrapper;
    }

    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    uint256 amountOutGross = calcBPoolGrossAmount(cvpAmountOut_, communityExitFee);

    uint256 currentBalance = IERC20(bPoolToken_).balanceOf(address(this));
    IERC20(bPoolToken_).approve(iBPool, currentBalance);
    amountIn = BPoolInterface(iBPool).exitswapExternAmountOut(cvp, amountOutGross, currentBalance);
    IERC20(bPoolToken_).approve(iBPool, 0);

    IERC20(cvp).transfer(xcvp, cvpAmountOut_);
  }

  /**
   * @notice The Strategy 2 exits from a PowerIndex pool token to one of it's bound tokens. Then it swaps this token
   * for CVP using a uniswap-like strategy. The pool should have CVP token bound. (For ASSY - like pools)
   * @param bPoolToken_ PowerIndex Pool Token
   * @return amountIn The amount of bPoolToken_ used as an input for the swap
   */
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

    if (config.bPoolWrapper != address(0)) {
      iBPool = config.bPoolWrapper;
      address underlyingCandidate = PowerIndexWrapper(config.bPoolWrapper).underlyingByPiToken(underlyingOrPiToExit);
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

  /**
   * @notice The Strategy 3 swaps the given token at the corresponding PowerIndex pool for CVP
   * @param underlyingOrPiToken_ Token to swap for CVP. If it is a piToken, all the balance is swapped for it's
   * underlying first.
   * @return amountIn The amount used as an input for the swap. For a piToken it returns the amount in underlying tokens
   */
  function _customStrategy3(address underlyingOrPiToken_) internal returns (uint256 amountIn) {
    Strategy3Config memory config = strategy3Config[underlyingOrPiToken_];
    BPoolInterface bPool = BPoolInterface(config.bPool);
    BPoolInterface bPoolWrapper = config.bPoolWrapper != address(0) ? BPoolInterface(config.bPoolWrapper) : bPool;
    address tokenIn = underlyingOrPiToken_;

    if (config.underlying != address(0)) {
      tokenIn = config.underlying;
      uint256 underlyingBalance = WrappedPiErc20Interface(underlyingOrPiToken_).balanceOfUnderlying(address(this));
      if (underlyingBalance > 0) {
        WrappedPiErc20Interface(underlyingOrPiToken_).withdraw(underlyingBalance);
      }
    }

    (uint256 communitySwapFee, , , ) = bPool.getCommunityFee();
    uint256 cvpAmountOut_ = cvpAmountOut;
    uint256 amountOutGross = calcBPoolGrossAmount(cvpAmountOut_, communitySwapFee);

    uint256 currentBalance = IERC20(tokenIn).balanceOf(address(this));
    IERC20(tokenIn).approve(address(bPoolWrapper), currentBalance);
    (amountIn, ) = bPoolWrapper.swapExactAmountOut(
      // tokenIn
      tokenIn,
      // maxAmountIn
      currentBalance,
      // tokenOut
      cvp,
      // tokenAmountOut
      amountOutGross,
      // maxPrice
      type(uint64).max
    );
    IERC20(tokenIn).approve(address(bPoolWrapper), 0);
    IERC20(cvp).transfer(xcvp, cvpAmountOut_);
  }

  /*** PERMISSIONLESS METHODS ***/

  /**
   * @notice Syncs the bound tokens for the Strategy2 PowerIndex pool token
   * @param token_ The pool token to sync
   */
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

  function setPoolRestrictions(address restrictions_) external onlyOwner {
    restrictions = IPoolRestrictions(restrictions_);
    emit SetPoolRestrictions(restrictions_);
  }

  function setCvpAmountOut(uint256 cvpAmountOut_) external onlyOwner {
    require(cvpAmountOut_ > 0, "CVP_AMOUNT_OUT_0");
    cvpAmountOut = cvpAmountOut_;
    emit SetCvpAmountOut(cvpAmountOut_);
  }

  function setCustomStrategy(address token_, uint256 strategyId_) public onlyOwner {
    customStrategies[token_] = strategyId_;
    emit SetCustomStrategy(token_, strategyId_);
  }

  function setCustomStrategy1Config(address bPoolToken_, address bPoolWrapper_) external onlyOwner {
    strategy1Config[bPoolToken_].bPoolWrapper = bPoolWrapper_;
    setCustomStrategy(bPoolToken_, 1);
  }

  function setCustomStrategy2Config(address bPoolToken, address bPoolWrapper_) external onlyOwner {
    strategy2Config[bPoolToken].bPoolWrapper = bPoolWrapper_;
    setCustomStrategy(bPoolToken, 2);
  }

  function setCustomStrategy3Config(
    address token_,
    address bPool_,
    address bPoolWrapper_,
    address underlying_
  ) external onlyOwner {
    strategy3Config[token_] = Strategy3Config(bPool_, bPoolWrapper_, underlying_);
    setCustomStrategy(token_, 3);
  }

  function setExternalStrategy(
    address token_,
    address strategy_,
    bool maxAmountIn_,
    bytes memory config_
  ) external onlyOwner {
    address prevStrategy = externalStrategiesConfig[token_].strategy;
    if (prevStrategy != address(0)) {
      IERC20(token_).safeApprove(prevStrategy, uint256(0));
    }

    externalStrategiesConfig[token_] = ExternalStrategiesConfig(strategy_, maxAmountIn_, config_);

    IERC20(token_).safeApprove(strategy_, uint256(-1));

    emit SetExternalStrategy(token_, strategy_, maxAmountIn_);
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
