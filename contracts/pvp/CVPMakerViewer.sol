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
import "../balancer-core/BMath.sol";
import "../balancer-core/BNum.sol";
import "./CVPMakerStorage.sol";

contract CVPMakerViewer is CVPMakerStorage {
  using SafeMath for uint256;
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;
  uint256 internal constant BONE = 10**18;

  /// @notice The event emitted when the owner updates the powerOracleStaking address
  event SetPowerPoke(address powerPoke);
  event Swap(address indexed caller, address indexed token, uint256 amountOut);
  event SetCvpAmountOut(uint256 cvpAmountOut);
  event SetCustomPath(address indexed token_, address router_, address[] path);
  event SetCustomStrategy(address indexed token, uint256 strategyId);

  // 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
  address public immutable uniswapRouter;

  // 0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1
  address public immutable cvp;

  // 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
  address public immutable weth;

  address public immutable xcvp;

  constructor(
    address cvp_,
    address xcvp_,
    address weth_,
    address uniswapRouter_,
    address restrictions_
  ) public {
    cvp = cvp_;
    xcvp = xcvp_;
    weth = weth_;
    uniswapRouter = uniswapRouter_;
    _restrictions = IPoolRestrictions(_restrictions);
  }

  function _wethCVPPath() internal view returns (address[] memory) {
    address[] memory path = new address[](2);
    path[0] = weth;
    path[1] = cvp;
    return path;
  }

  function getRouter(address token_) public view returns (address) {
    address router = routers[token_];

    if (router == address(0)) {
      return uniswapRouter;
    }

    return router;
  }

  function getPath(address token_) public view returns (address[] memory) {
    address[] storage customPath = customPaths[token_];

    if (customPath.length == 0) {
      return getDefaultPath(token_);
    }

    return customPath;
  }

  function getDefaultPath(address token_) public view returns (address[] memory) {
    address[] memory path = new address[](3);

    path[0] = token_;
    path[1] = weth;
    path[2] = cvp;

    return path;
  }

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

  function getUniLikeRouterAndPath(address token_) public view returns (address router, address[] memory path) {
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

  function estimateEthStrategyIn() public view returns (uint256) {
    uint256[] memory results = IUniswapV2Router02(uniswapRouter).getAmountsIn(cvpAmountOut, _wethCVPPath());
    return results[0];
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
    if (balance == 0) {
      return 0;
    }
    return _estimateUniLikeStrategyOut(token_, balance);
  }

  function _estimateUniLikeStrategyOut(address token_, uint256 balance_) internal view returns (uint256) {
    address router = getRouter(token_);
    address[] memory path = getPath(token_);
    uint256[] memory results = IUniswapV2Router02(router).getAmountsOut(balance_, path);
    if (router == uniswapRouter) {
      return results[results.length - 1];
    } else {
      return _estimateEthStrategyOut(results[results.length - 1]);
    }
  }

  // How many token_s need to swap for cvpAmountOut
  function estimateUniLikeStrategyIn(address token_) public view returns (uint256) {
    address router = getRouter(token_);
    address[] memory path = getPath(token_);

    if (router == uniswapRouter) {
      uint256[] memory results = IUniswapV2Router02(router).getAmountsIn(cvpAmountOut, path);
      return results[0];
    } else {
      uint256 wethToSwap = estimateEthStrategyIn();
      uint256[] memory results = IUniswapV2Router02(router).getAmountsIn(wethToSwap, path);
      return results[0];
    }
  }

  /*** CUSTOM STRATEGIES OUT ***/

  function estimateCustomStrategyOut(address token_, uint256 strategyId_) public view returns (uint256) {
    if (strategyId_ == 1) {
      return estimateStrategy1Out(token_);
    } else if (strategyId_ == 2) {
      return estimateStrategy2Out(token_);
    } else {
      revert("INVALID_STRATEGY_ID");
    }
  }

  function estimateCustomStrategyIn(address token_, uint256 strategyId_) public view returns (uint256) {
    if (strategyId_ == 1) {
      return estimateStrategy1In(token_);
    } else if (strategyId_ == 2) {
      return estimateStrategy2In(token_);
    } else {
      revert("INVALID_STRATEGY_ID");
    }
  }

  // Hom many bPool tokens to burn to get the current cvpAmountOut
  function estimateStrategy1In(address bPoolToken_) public view returns (uint256) {
    return bPoolGetExitAmountIn(bPoolToken_, cvp, cvpAmountOut);
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
    address tokenToExit = config.tokens[config.nextIndex];
    uint256 uniLikeAmountIn = estimateUniLikeStrategyIn(tokenToExit);

    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    uint256 amountOutWithFee = calcBPoolAmountOutWithCommunityFee(uniLikeAmountIn, communityExitFee);

    return bPoolGetExitAmountIn(bPoolToken_, tokenToExit, amountOutWithFee);
  }

  // Hom many CVP tokens can be returned by exiting with the all bPool balance and swapping the exit amount
  // with uniLike strategy
  function estimateStrategy2Out(address bPoolToken_) public view returns (uint256) {
    require(strategy2Config[bPoolToken_].tokens.length > 0, "TOKENS_NOT_CONFIGURED");
    Strategy2Config storage config = strategy2Config[bPoolToken_];
    address tokenToExit = config.tokens[config.nextIndex];
    uint256 tokenAmountOut =
      bPoolGetExitAmountOut(bPoolToken_, tokenToExit, IERC20(bPoolToken_).balanceOf(address(this)));
    (, , uint256 communityExitFee, ) = BPoolInterface(bPoolToken_).getCommunityFee();
    (uint256 amountOutWithFee, ) =
      BPoolInterface(bPoolToken_).calcAmountWithCommunityFee(tokenAmountOut, communityExitFee, address(this));
    return _estimateUniLikeStrategyOut(tokenToExit, amountOutWithFee);
  }

  function calcBPoolAmountOutWithCommunityFee(uint256 tokenAmountIn_, uint256 communityFee_)
    public
    view
    returns (uint256 tokenAmountInAfterFee)
  {
    if (address(_restrictions) != address(0) && _restrictions.isWithoutFee(address(this))) {
      return (tokenAmountIn_);
    }
    uint256 adjustedIn = bsub(BONE, communityFee_);
    return bdiv(tokenAmountIn_, adjustedIn);
  }

  function bsub(uint256 a, uint256 b) internal pure returns (uint256) {
    (uint256 c, bool flag) = bsubSign(a, b);
    require(!flag, "ERR_SUB_UNDERFLOW");
    return c;
  }

  function bsubSign(uint256 a, uint256 b) internal pure returns (uint256, bool) {
    if (a >= b) {
      return (a - b, false);
    } else {
      return (b - a, true);
    }
  }

  function bdiv(uint256 a, uint256 b) internal pure returns (uint256) {
    require(b != 0, "ERR_DIV_ZERO");
    uint256 c0 = a * BONE;
    require(a == 0 || c0 / a == BONE, "ERR_DIV_INTERNAL"); // bmul overflow
    uint256 c1 = c0 + (b / 2);
    require(c1 >= c0, "ERR_DIV_INTERNAL"); //  badd require
    uint256 c2 = c1 / b;
    return c2;
  }

  function bPoolGetExitAmountIn(
    address bpool_,
    address tokenOut_,
    uint256 amountOut_
  ) public view returns (uint256) {
    BPoolInterface bpool = BPoolInterface(bpool_);

    return
      BMath(bpool_).calcPoolInGivenSingleOut(
        // tokenBalanceOut
        IERC20(tokenOut_).balanceOf(bpool_),
        // tokenWeightOut
        bpool.getDenormalizedWeight(tokenOut_),
        // poolSupply
        bpool.totalSupply(),
        // totalWeight (denormalized)
        bpool.getTotalDenormalizedWeight(),
        // tokenAmountOut
        amountOut_,
        // swapFee
        bpool.getSwapFee()
      );
  }

  function bPoolGetExitAmountOut(
    address bpool_,
    address tokenOut_,
    uint256 amountIn_
  ) public view returns (uint256) {
    BPoolInterface bpool = BPoolInterface(bpool_);

    return
      BMath(bpool_).calcSingleOutGivenPoolIn(
        // tokenBalanceOut
        IERC20(tokenOut_).balanceOf(bpool_),
        // tokenWeightOut
        bpool.getDenormalizedWeight(tokenOut_),
        // poolSupply
        bpool.totalSupply(),
        // totalWeight (denormalized)
        bpool.getTotalDenormalizedWeight(),
        // poolAmountIn
        amountIn_,
        // swapFee
        bpool.getSwapFee()
      );
  }
}
