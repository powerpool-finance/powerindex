// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/BPoolInterface.sol";
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
    } else {
      return estimateUniLikeStrategyIn(token_);
    }
  }

  // How much CVP can be returned by swapping all the token_ balance
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
    Strategy1Config storage config = strategy1Config[bPoolToken_];
    bool wrapperMode = false;
    address iBPool = bPoolToken_;
    if (config.bPool != address(0)) {
      wrapperMode = true;
      iBPool = config.bPool;
    }
    return bPoolGetExitAmountIn(iBPool, cvp, cvpAmountOut, wrapperMode);
  }

  // Hom many CVP tokens will be received in the case of burning all the available bPool tokens
  function estimateStrategy1Out(address bPoolToken_) public view returns (uint256) {
    return bPoolGetExitAmountOut(bPoolToken_, cvp, IERC20(bPoolToken_).balanceOf(address(this)));
  }

  // Hom many bPool tokens to burn to get the current cvpAmountOut by swapping the exitToken token with
  // the corresponding uniLike path
  function estimateStrategy2In(address bPoolToken_) public view returns (uint256) {
    require(strategy2Config[bPoolToken_].tokens.length > 0, "TOKENS_NOT_CONFIGURED");
    Strategy2Config storage config = strategy2Config[bPoolToken_];
    address underlyingOrPiToExit = config.tokens[config.nextIndex];
    address underlyingToken = underlyingOrPiToExit;
    address iBPool = bPoolToken_;

    if (config.bPool != address(0)) {
      iBPool = config.bPool;
      address underlyingCandidate = PowerIndexWrapper(config.bPool).underlyingByPiToken(underlyingOrPiToExit);
      if (underlyingCandidate != address(0)) {
        underlyingToken = underlyingCandidate;
      }
    }
    uint256 uniLikeAmountIn = estimateUniLikeStrategyIn(underlyingToken);

    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    uint256 amountOutGross = calcBPoolGrossAmount(uniLikeAmountIn, communityExitFee);

    return bPoolGetExitAmountIn(iBPool, underlyingOrPiToExit, amountOutGross, config.bPool != address(0));
  }

  // Hom many CVP tokens can be returned by exiting with the all bPool balance and swapping the exit amount
  // with uniLike strategy
  function estimateStrategy2Out(address bPoolToken_) public view returns (uint256) {
    require(strategy2Config[bPoolToken_].tokens.length > 0, "TOKENS_NOT_CONFIGURED");
    Strategy2Config storage config = strategy2Config[bPoolToken_];
    address tokenToExit = config.tokens[config.nextIndex];
    address tokenToEstimate = tokenToExit;
    address iBPool = config.bPool == address(0) ? bPoolToken_ : config.bPool;

    if (config.bPool != address(0)) {
      address underlyingCandidate = PowerIndexWrapper(config.bPool).underlyingByPiToken(tokenToExit);
      if (underlyingCandidate != address(0)) {
        tokenToEstimate = underlyingCandidate;
      }
    }

    uint256 tokenAmountOut =
      bPoolGetExitAmountOut(bPoolToken_, tokenToExit, IERC20(bPoolToken_).balanceOf(address(this)));
    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    (uint256 amountOutWithFee, ) =
      BPoolInterface(bPoolToken_).calcAmountWithCommunityFee(tokenAmountOut, communityExitFee, address(this));
    return _estimateUniLikeStrategyOut(tokenToEstimate, amountOutWithFee);
  }

  function estimateStrategy3In(address token_) public view returns (uint256) {
    Strategy3Config storage config = strategy3Config[token_];

    (uint256 communitySwapFee, , , ) = BPoolInterface(config.bPool).getCommunityFee();
    uint256 amountOutGross = calcBPoolGrossAmount(cvpAmountOut, communitySwapFee);

    return bPoolGetSwapAmountIn(config.bPool, token_, cvp, amountOutGross);
  }

  function estimateStrategy3Out(address token_) public view returns (uint256) {
    Strategy3Config storage config = strategy3Config[token_];

    uint256 amountOutNet = bPoolGetSwapAmountOut(config.bPool, token_, cvp, IERC20(token_).balanceOf(address(this)));
    (uint256 communitySwapFee, , , ) = BPoolInterface(config.bPool).getCommunityFee();
    (uint256 amountOutGross, ) =
      BPoolInterface(config.bPool).calcAmountWithCommunityFee(amountOutNet, communitySwapFee, address(this));
    return amountOutGross;
  }

  function bPoolGetSwapAmountIn(
    address bPool_,
    address tokenIn_,
    address tokenOut_,
    uint256 amountOut_
  ) public view returns (uint256) {
    BPoolInterface bPool = BPoolInterface(bPool_);

    return
      BMath(bPool_).calcInGivenOut(
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
    address tokenIn_,
    address tokenOut_,
    uint256 amountIn_
  ) public view returns (uint256) {
    BPoolInterface bPool = BPoolInterface(bPool_);

    return
      BMath(bPool_).calcOutGivenIn(
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
   */
  function bPoolGetExitAmountIn(
    address bPool_,
    address tokenOut_,
    uint256 amountOut_,
    bool wrapperMode_
  ) public view returns (uint256) {
    BPoolInterface bPool = BPoolInterface(bPool_);
    uint256 totalSupply;
    uint256 totalDenormalizedWeight;
    address totalSupplyKeeper;

    if (wrapperMode_) {
      PowerIndexWrapper wrapper = PowerIndexWrapper(bPool_);
      BPoolInterface actualBPool = wrapper.bpool();
      totalSupply = actualBPool.totalSupply();
      totalDenormalizedWeight = actualBPool.getTotalDenormalizedWeight();
      totalSupplyKeeper = address(actualBPool);
    } else {
      totalSupply = bPool.totalSupply();
      totalDenormalizedWeight = bPool.getTotalDenormalizedWeight();
      totalSupplyKeeper = bPool_;
    }

    return
      BMath(bPool_).calcPoolInGivenSingleOut(
        // tokenBalanceOut
        IERC20(tokenOut_).balanceOf(totalSupplyKeeper),
        // tokenWeightOut
        bPool.getDenormalizedWeight(tokenOut_),
        // poolSupply
        totalSupply,
        // totalWeight (denormalized)
        totalDenormalizedWeight,
        // tokenAmountOut
        amountOut_,
        // swapFee
        bPool.getSwapFee()
      );
  }

  function bPoolGetExitAmountOut(
    address bPool_,
    address tokenOut_,
    uint256 amountIn_
  ) public view returns (uint256) {
    BPoolInterface bPool = BPoolInterface(bPool_);

    return
      BMath(bPool_).calcSingleOutGivenPoolIn(
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
