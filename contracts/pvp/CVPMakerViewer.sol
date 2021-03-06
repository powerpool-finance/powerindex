// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "./CVPMakerStorage.sol";
import "../interfaces/ICVPMakerViewer.sol";

contract CVPMakerViewer is ICVPMakerViewer, CVPMakerStorage {
  using SafeMath for uint256;

  address internal constant ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;
  uint256 internal constant BONE = 10**18;

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

  function getRouter(address token_) public view override returns (address) {
    address router = routers[token_];

    if (router == address(0)) {
      return uniswapRouter;
    }

    return router;
  }

  function getPath(address token_) public view override returns (address[] memory) {
    address[] storage customPath = customPaths[token_];

    if (customPath.length == 0) {
      return getDefaultPath(token_);
    }

    return customPath;
  }

  function getDefaultPath(address token_) public view override returns (address[] memory) {
    address[] memory path = new address[](3);

    path[0] = token_;
    path[1] = weth;
    path[2] = cvp;

    return path;
  }

  /*** ESTIMATIONS ***/

  function estimateEthStrategyIn() public view override returns (uint256) {
    uint256[] memory results = IUniswapV2Router02(uniswapRouter).getAmountsIn(cvpAmountOut, _wethCVPPath());
    return results[0];
  }

  /**
   * @notice Estimates how much token_ need to swap for cvpAmountOut
   * @param token_ The token to swap for CVP
   * @return The estimated token_ amount in
   */
  function estimateUniLikeStrategyIn(address token_) public view override returns (uint256) {
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

  /**
   * @notice Calculates the gross amount based on a net and a fee values. The function is opposite to
   * the BPool.calcAmountWithCommunityFee().
   */
  function calcBPoolGrossAmount(uint256 tokenAmountNet_, uint256 communityFee_)
    public
    view
    override
    returns (uint256 tokenAmountGross)
  {
    if (address(_restrictions) != address(0) && _restrictions.isWithoutFee(address(this))) {
      return (tokenAmountNet_);
    }
    uint256 adjustedIn = bsub(BONE, communityFee_);
    return bdiv(tokenAmountNet_, adjustedIn);
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
}
