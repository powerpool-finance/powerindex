// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/BPoolInterface.sol";
import "../interfaces/ICVPMakerStrategy.sol";
import "./CVPMakerViewer.sol";
import "../powerindex-router/PowerIndexWrapper.sol";

abstract contract CVPMakerLens is CVPMakerViewer {
  function getStrategy2NextIndex(address token_) external view returns (uint256) {
    return strategy2Config[token_].nextIndex;
  }

  function getStrategy2NextTokenToExit(address token_) external view returns (address) {
    require(strategy2Config[token_].tokens.length > 0, "TOKENS_NOT_CONFIGURED");
    return strategy2Config[token_].tokens[strategy2Config[token_].nextIndex];
  }

  function getStrategy2Tokens(address token_) external view returns (address[] memory) {
    return strategy2Config[token_].tokens;
  }

  function getUniLikeRouterAndPath(address token_) external view returns (address router, address[] memory path) {
    return (routers[token_], customPaths[token_]);
  }

  /*** ESTIMATIONS ***/

  // How much token_s you need in order to convert them to cvpAmountOut right away
  function estimateSwapAmountIn(address token_) external view returns (uint256) {
    if (token_ == cvp) {
      return cvpAmountOut;
    }

    if (token_ == weth || token_ == ETH) {
      return estimateEthStrategyIn();
    }

    uint256 customStrategyId = customStrategies[token_];
    if (customStrategyId > 0) {
      return estimateCustomStrategyIn(token_, customStrategyId);
    }

    if (externalStrategiesConfig[token_].strategy != address(0)) {
      return estimateExternalStrategyIn(token_);
    }

    return estimateUniLikeStrategyIn(token_);
  }

  // How much CVP can be returned by swapping all the token_ balance
  // Does not support estimations for the external strategies
  function estimateCvpAmountOut(address token_) external view returns (uint256) {
    if (token_ == cvp) {
      return IERC20(cvp).balanceOf(address(this));
    }

    if (token_ == weth || token_ == ETH) {
      return estimateEthStrategyOut(token_);
    }

    uint256 customStrategyId = customStrategies[token_];
    if (customStrategyId > 0) {
      return estimateCustomStrategyOut(token_, customStrategyId);
    } else {
      return estimateUniLikeStrategyOut(token_);
    }
  }

  function estimateEthStrategyOut(address token_) public view returns (uint256) {
    uint256 balanceIn = token_ == weth ? IERC20(weth).balanceOf(address(this)) : address(this).balance;
    if (balanceIn == 0) {
      return 0;
    }
    return _estimateEthStrategyOut(balanceIn);
  }

  function _estimateEthStrategyOut(uint256 _balanceIn) internal view returns (uint256) {
    uint256[] memory results = IUniswapV2Router02(uniswapRouter).getAmountsOut(_balanceIn, _wethCVPPath());
    return results[1];
  }

  // How many CVP can get for the current token_ balance
  function estimateUniLikeStrategyOut(address token_) public view returns (uint256) {
    uint256 balance = IERC20(token_).balanceOf(address(this));
    return _estimateUniLikeStrategyOut(token_, balance);
  }

  function _estimateUniLikeStrategyOut(address token_, uint256 balance_) internal view returns (uint256) {
    if (balance_ == 0) {
      return 0;
    }

    address router = getRouter(token_);
    address[] memory path = getPath(token_);
    uint256[] memory results = IUniswapV2Router02(router).getAmountsOut(balance_, path);
    if (router == uniswapRouter) {
      return results[results.length - 1];
    } else {
      return _estimateEthStrategyOut(results[results.length - 1]);
    }
  }

  /*** CUSTOM STRATEGIES ***/

  function estimateCustomStrategyIn(address token_, uint256 strategyId_) public view returns (uint256) {
    if (strategyId_ == 1) {
      return estimateStrategy1In(token_);
    } else if (strategyId_ == 2) {
      return estimateStrategy2In(token_);
    } else if (strategyId_ == 3) {
      return estimateStrategy3In(token_);
    } else {
      revert("INVALID_STRATEGY_ID");
    }
  }

  function estimateExternalStrategyIn(address token_) public view returns (uint256) {
    ExternalStrategiesConfig storage strategyConfig = externalStrategiesConfig[token_];
    if (strategyConfig.maxAmountIn) {
      return IERC20(token_).balanceOf(address(this));
    }
    return ICVPMakerStrategy(strategyConfig.strategy).estimateIn(
      token_,
      estimateUniLikeStrategyIn(ICVPMakerStrategy(strategyConfig.strategy).getTokenOut()),
      strategyConfig.config
    );
  }

  function estimateCustomStrategyOut(address token_, uint256 strategyId_) public view returns (uint256) {
    if (strategyId_ == 1) {
      return estimateStrategy1Out(token_);
    } else if (strategyId_ == 2) {
      return estimateStrategy2Out(token_);
    } else if (strategyId_ == 3) {
      return estimateStrategy3Out(token_);
    } else {
      revert("INVALID_STRATEGY_ID");
    }
  }

  // Hom many bPool tokens to burn to get the current cvpAmountOut
  function estimateStrategy1In(address bPoolToken_) public view returns (uint256) {
    Strategy1Config memory config = strategy1Config[bPoolToken_];
    return
      bPoolGetExitAmountIn({
        bPool_: bPoolToken_,
        bPoolWrapper_: config.bPoolWrapper != address(0) ? config.bPoolWrapper : bPoolToken_,
        tokenOut_: cvp,
        amountOut_: cvpAmountOut
      });
  }

  // Hom many CVP tokens will be received in the case of burning all the available bPool tokens
  function estimateStrategy1Out(address bPoolToken_) public view returns (uint256) {
    Strategy1Config memory config = strategy1Config[bPoolToken_];
    return
      bPoolGetExitAmountOut({
        bPool_: bPoolToken_,
        bPoolWrapper_: config.bPoolWrapper != address(0) ? config.bPoolWrapper : bPoolToken_,
        tokenOut_: cvp,
        amountIn_: IERC20(bPoolToken_).balanceOf(address(this))
      });
  }

  // Hom many bPool tokens to burn to get the current cvpAmountOut by swapping the exitToken token with
  // the corresponding uniLike path
  function estimateStrategy2In(address bPoolToken_) public view returns (uint256) {
    require(strategy2Config[bPoolToken_].tokens.length > 0, "TOKENS_NOT_CONFIGURED");
    Strategy2Config storage config = strategy2Config[bPoolToken_];
    address underlyingOrPiToExit = config.tokens[config.nextIndex];
    address underlyingToken = underlyingOrPiToExit;

    if (config.bPoolWrapper != address(0)) {
      address underlyingCandidate = PowerIndexWrapper(config.bPoolWrapper).underlyingByPiToken(underlyingOrPiToExit);
      if (underlyingCandidate != address(0)) {
        underlyingToken = underlyingCandidate;
      }
    }
    uint256 uniLikeAmountIn = estimateUniLikeStrategyIn(underlyingToken);

    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    uint256 amountOutGross = calcBPoolGrossAmount(uniLikeAmountIn, communityExitFee);

    return
      bPoolGetExitAmountIn({
        bPool_: bPoolToken_,
        bPoolWrapper_: config.bPoolWrapper != address(0) ? config.bPoolWrapper : bPoolToken_,
        tokenOut_: underlyingOrPiToExit,
        amountOut_: amountOutGross
      });
  }

  // Hom many CVP tokens can be returned by exiting with the all bPool balance and swapping the exit amount
  // with uniLike strategy
  function estimateStrategy2Out(address bPoolToken_) public view returns (uint256) {
    require(strategy2Config[bPoolToken_].tokens.length > 0, "TOKENS_NOT_CONFIGURED");
    Strategy2Config storage config = strategy2Config[bPoolToken_];
    address tokenToExit = config.tokens[config.nextIndex];
    address tokenToEstimate = tokenToExit;

    if (config.bPoolWrapper != address(0)) {
      address underlyingCandidate = PowerIndexWrapper(config.bPoolWrapper).underlyingByPiToken(tokenToExit);
      if (underlyingCandidate != address(0)) {
        tokenToEstimate = underlyingCandidate;
      }
    }

    uint256 tokenAmountOut =
      bPoolGetExitAmountOut({
        bPool_: bPoolToken_,
        bPoolWrapper_: config.bPoolWrapper != address(0) ? config.bPoolWrapper : bPoolToken_,
        tokenOut_: tokenToExit,
        amountIn_: IERC20(bPoolToken_).balanceOf(address(this))
      });
    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    (uint256 amountOutWithFee, ) =
      BPoolInterface(bPoolToken_).calcAmountWithCommunityFee(tokenAmountOut, communityExitFee, address(this));
    return _estimateUniLikeStrategyOut(tokenToEstimate, amountOutWithFee);
  }

  /**
   * Estimates the amount of the given tokens required to be swapped for the cvpAmountOut. For a piToken it doesn't
   * include the underlying balance, while the actual swap will.
   * @param underlyingOrPiToken_ Either a piToken or it's underlying to swap for CVP
   * @return amountIn in the given tokens
   */
  function estimateStrategy3In(address underlyingOrPiToken_) public view returns (uint256) {
    Strategy3Config storage config = strategy3Config[underlyingOrPiToken_];
    bool wrappedMode = false;

    BPoolInterface bPool = BPoolInterface(config.bPool);
    BPoolInterface bPoolWrapper = config.bPoolWrapper != address(0) ? BPoolInterface(config.bPoolWrapper) : bPool;

    (uint256 communitySwapFee, , , ) = bPool.getCommunityFee();
    uint256 amountOutGross = calcBPoolGrossAmount(cvpAmountOut, communitySwapFee);

    address tokenIn = underlyingOrPiToken_;

    uint256 amountIn =
      bPoolGetSwapAmountIn({
        bPool_: address(bPool),
        bPoolWrapper_: address(bPoolWrapper),
        tokenIn_: underlyingOrPiToken_,
        tokenOut_: cvp,
        amountOut_: amountOutGross
      });

    if (config.underlying != address(0)) {
      return WrappedPiErc20Interface(underlyingOrPiToken_).getUnderlyingEquivalentForPi(amountIn);
    } else {
      return amountIn;
    }
  }

  /**
   * Estimates the amount of CVP can be received by swapping the given tokens
   * @param underlyingOrPiToken_ Either a piToken or it's underlying to swap for CVP
   * @return amountOut The estimated amount of CVP tokens
   */
  function estimateStrategy3Out(address underlyingOrPiToken_) public view returns (uint256) {
    Strategy3Config storage config = strategy3Config[underlyingOrPiToken_];
    address tokenIn = underlyingOrPiToken_;
    uint256 balance;

    BPoolInterface bPool = BPoolInterface(config.bPool);
    BPoolInterface bPoolWrapper = config.bPoolWrapper != address(0) ? BPoolInterface(config.bPoolWrapper) : bPool;

    if (config.underlying != address(0)) {
      tokenIn = config.underlying;
      balance = WrappedPiErc20Interface(underlyingOrPiToken_).getUnderlyingEquivalentForPi(
        IERC20(underlyingOrPiToken_).balanceOf(address(this))
      );
    } else {
      balance = IERC20(underlyingOrPiToken_).balanceOf(address(this));
    }

    uint256 amountOutNet =
      bPoolGetSwapAmountOut({
        bPool_: address(bPool),
        bPoolWrapper_: address(bPoolWrapper),
        tokenIn_: underlyingOrPiToken_,
        tokenOut_: cvp,
        amountIn_: balance
      });

    (uint256 communitySwapFee, , , ) = BPoolInterface(config.bPool).getCommunityFee();
    (uint256 amountOutGross, ) =
      BPoolInterface(config.bPool).calcAmountWithCommunityFee(amountOutNet, communitySwapFee, address(this));
    return amountOutGross;
  }

  /**
   * Estimates the amountIn based on amountOut.
   * @param bPool_ The BPool
   * @param bPoolWrapper_ The BPool wrapper. The same address as BPool in case if it doesn't have a wrapper.
   * @param tokenIn_ The token itself or the corresponding piToken
   * @param tokenOut_ The token itself or the corresponding piToken
   * @param amountOut_ The amount out
   * @return amountIn The estimated amount in
   */
  function bPoolGetSwapAmountIn(
    address bPool_,
    address bPoolWrapper_,
    address tokenIn_,
    address tokenOut_,
    uint256 amountOut_
  ) public view returns (uint256) {
    BPoolInterface bPool = BPoolInterface(bPool_);

    return
      BMath(bPoolWrapper_).calcInGivenOut(
        // tokenBalanceIn
        IERC20(tokenIn_).balanceOf(bPool_),
        // tokenWeightIn
        bPool.getDenormalizedWeight(tokenIn_),
        // tokenBalanceOut
        IERC20(tokenOut_).balanceOf(bPool_),
        // tokenWeightOut
        bPool.getDenormalizedWeight(tokenOut_),
        // tokenAmountOut
        amountOut_,
        // swapFee
        bPool.getSwapFee()
      );
  }

  function bPoolGetSwapAmountOut(
    address bPool_,
    address bPoolWrapper_,
    address tokenIn_,
    address tokenOut_,
    uint256 amountIn_
  ) public view returns (uint256) {
    BPoolInterface bPool = BPoolInterface(bPool_);

    return
      BMath(bPoolWrapper_).calcOutGivenIn(
        // tokenBalanceIn
        IERC20(tokenIn_).balanceOf(bPool_),
        // tokenWeightIn
        bPool.getDenormalizedWeight(tokenIn_),
        // tokenBalanceOut
        IERC20(tokenOut_).balanceOf(bPool_),
        // tokenWeightOut
        bPool.getDenormalizedWeight(tokenOut_),
        // tokenAmountOut
        amountIn_,
        // swapFee
        bPool.getSwapFee()
      );
  }

  /**
   * @param bPool_ Either a pool or a wrapper contract, should be used in combination with the wrapperMode_ param
   * @param bPoolWrapper_ The BPool wrapper. The same address as BPool in the case if it doesn't have a wrapper.
   * @param tokenOut_ The token out address
   * @param amountOut_ The expected amount for the exit
   * @return amountIn The estimated amount in in pool tokens.
   */
  function bPoolGetExitAmountIn(
    address bPool_,
    address bPoolWrapper_,
    address tokenOut_,
    uint256 amountOut_
  ) public view returns (uint256) {
    BPoolInterface bPool = BPoolInterface(bPool_);

    return
      BMath(bPoolWrapper_).calcPoolInGivenSingleOut(
        // tokenBalanceOut
        IERC20(tokenOut_).balanceOf(bPool_),
        // tokenWeightOut
        bPool.getDenormalizedWeight(tokenOut_),
        // poolSupply
        bPool.totalSupply(),
        // totalWeight (denormalized)
        bPool.getTotalDenormalizedWeight(),
        // tokenAmountOut
        amountOut_,
        // swapFee
        bPool.getSwapFee()
      );
  }

  function bPoolGetExitAmountOut(
    address bPool_,
    address bPoolWrapper_,
    address tokenOut_,
    uint256 amountIn_
  ) public view returns (uint256) {
    BPoolInterface bPool = BPoolInterface(bPool_);

    return
      BMath(bPoolWrapper_).calcSingleOutGivenPoolIn(
        // tokenBalanceOut
        IERC20(tokenOut_).balanceOf(bPool_),
        // tokenWeightOut
        bPool.getDenormalizedWeight(tokenOut_),
        // poolSupply
        bPool.totalSupply(),
        // totalWeight (denormalized)
        bPool.getTotalDenormalizedWeight(),
        // poolAmountIn
        amountIn_,
        // swapFee
        bPool.getSwapFee()
      );
  }
}
