// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/BPoolInterface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@nomiclabs/buidler/console.sol";


contract BPoolWrapper {
    using SafeMath for uint256;

    BPoolInterface public immutable bpool;

    constructor(address _bpool) public {
        bpool = BPoolInterface(_bpool);
    }

    function swapExactAmountOut(
        address tokenIn,
        uint maxAmountIn,
        address tokenOut,
        uint tokenAmountOut,
        uint maxPrice
    )
        external
        returns (uint tokenAmountIn, uint spotPriceAfter)
    {
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), maxAmountIn), "ERR_TRANSFER_FAILED");
        if (IERC20(tokenIn).allowance(address(this), address(bpool)) > 0) {
            IERC20(tokenIn).approve(address(bpool), 0);
        }
        IERC20(tokenIn).approve(address(bpool), maxAmountIn);

        (tokenAmountIn, spotPriceAfter) = bpool.swapExactAmountOut(
            tokenIn,
            maxAmountIn,
            tokenOut,
            tokenAmountOut,
            maxPrice
        );

        require(IERC20(tokenIn).transfer(msg.sender, maxAmountIn.sub(tokenAmountIn)), "ERR_TRANSFER_FAILED");
        require(IERC20(tokenOut).transfer(msg.sender, IERC20(tokenOut).balanceOf(address(this))), "ERR_TRANSFER_FAILED");

        return (tokenAmountIn, spotPriceAfter);
    }

    function swapExactAmountIn(
        address tokenIn,
        uint tokenAmountIn,
        address tokenOut,
        uint minAmountOut,
        uint maxPrice
    )
        external
        returns (uint tokenAmountOut, uint spotPriceAfter)
    {
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), tokenAmountIn), "ERR_TRANSFER_FAILED");
        if (IERC20(tokenIn).allowance(address(this), address(bpool)) > 0) {
            IERC20(tokenIn).approve(address(bpool), 0);
        }
        IERC20(tokenIn).approve(address(bpool), tokenAmountIn);

        (tokenAmountOut, spotPriceAfter) = bpool.swapExactAmountIn(
            tokenIn,
            tokenAmountIn,
            tokenOut,
            minAmountOut,
            maxPrice
        );

        require(IERC20(tokenOut).transfer(msg.sender, IERC20(tokenOut).balanceOf(address(this))), "ERR_TRANSFER_FAILED");

        return (tokenAmountOut, spotPriceAfter);
    }

    function joinPool(
        uint poolAmountOut,
        uint[] calldata maxAmountsIn
    ) external {
        address[] memory tokens = bpool.getFinalTokens();
        require(maxAmountsIn.length == tokens.length, "ERR_LENGTH_MISMATCH");

        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            require(token.transferFrom(msg.sender, address(this), maxAmountsIn[i]), "ERR_TRANSFER_FAILED");
            if (token.allowance(address(this), address(bpool)) > 0) {
                token.approve(address(bpool), 0);
            }
            token.approve(address(bpool), maxAmountsIn[i]);
        }
        bpool.joinPool(poolAmountOut, maxAmountsIn);
        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            if (token.balanceOf(address(this)) > 0) {
                require(token.transfer(msg.sender, token.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
            }
        }
        require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
    }

    function exitPool(
        uint poolAmountIn,
        uint[] calldata minAmountsOut
    ) external {
        address[] memory tokens = bpool.getFinalTokens();
        require(minAmountsOut.length == tokens.length, "ERR_LENGTH_MISMATCH");

        bpool.transferFrom(msg.sender, address(this), poolAmountIn);
        bpool.approve(address(bpool), poolAmountIn);
        bpool.exitPool(poolAmountIn, minAmountsOut);

        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            if (token.balanceOf(address(this)) > 0) {
                require(token.transfer(msg.sender, token.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
            }
        }
    }

    function joinswapExternAmountIn(
        address tokenIn,
        uint tokenAmountIn,
        uint minPoolAmountOut
    )
        external
        returns (uint poolAmountOut)
    {
        IERC20 token = IERC20(tokenIn);
        require(token.transferFrom(msg.sender, address(this), tokenAmountIn), "ERR_TRANSFER_FAILED");
        if (token.allowance(address(this), address(bpool)) > 0) {
            token.approve(address(bpool), 0);
        }
        token.approve(address(bpool), tokenAmountIn);
        poolAmountOut = bpool.joinswapExternAmountIn(tokenIn, tokenAmountIn, minPoolAmountOut);
        require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
        return poolAmountOut;
    }

    function joinswapPoolAmountOut(
        address tokenIn,
        uint poolAmountOut,
        uint maxAmountIn
    )
        external
        returns (uint tokenAmountIn)
    {
        IERC20 token = IERC20(tokenIn);
        require(token.transferFrom(msg.sender, address(this), maxAmountIn), "ERR_TRANSFER_FAILED");
        if (token.allowance(address(this), address(bpool)) > 0) {
            token.approve(address(bpool), 0);
        }
        token.approve(address(bpool), maxAmountIn);
        tokenAmountIn = bpool.joinswapPoolAmountOut(tokenIn, poolAmountOut, maxAmountIn);
        require(token.transfer(msg.sender, maxAmountIn.sub(tokenAmountIn)), "ERR_TRANSFER_FAILED");
        require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
        return tokenAmountIn;
    }

    function exitswapPoolAmountIn(
        address tokenOut,
        uint poolAmountIn,
        uint minAmountOut
    )
        external
        returns (uint tokenAmountOut)
    {
        require(bpool.transferFrom(msg.sender, address(this), poolAmountIn), "ERR_TRANSFER_FAILED");
        bpool.approve(address(bpool), poolAmountIn);
        tokenAmountOut = bpool.exitswapPoolAmountIn(tokenOut, poolAmountIn, minAmountOut);
        require(IERC20(tokenOut).transfer(msg.sender, IERC20(tokenOut).balanceOf(address(this))), "ERR_TRANSFER_FAILED");
        return tokenAmountOut;
    }

    function exitswapExternAmountOut(
        address tokenOut,
        uint tokenAmountOut,
        uint maxPoolAmountIn
    )
        external
        returns (uint poolAmountIn)
    {
        require(bpool.transferFrom(msg.sender, address(this), maxPoolAmountIn), "ERR_TRANSFER_FAILED");
        bpool.approve(address(bpool), maxPoolAmountIn);
        poolAmountIn = bpool.exitswapExternAmountOut(tokenOut, tokenAmountOut, maxPoolAmountIn);
        require(IERC20(tokenOut).transfer(msg.sender, tokenAmountOut), "ERR_TRANSFER_FAILED");
        require(bpool.transfer(msg.sender, maxPoolAmountIn.sub(poolAmountIn)), "ERR_TRANSFER_FAILED");
        return poolAmountIn;
    }

    function calcInGivenOut(
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint tokenAmountOut,
        uint swapFee
    )
        public
        view
        returns (uint tokenAmountIn)
    {
        return bpool.calcInGivenOut(
            tokenBalanceIn,
            tokenWeightIn,
            tokenBalanceOut,
            tokenWeightOut,
            tokenAmountOut,
            swapFee
        );
    }

    function getBalance(address token) external view returns (uint) {
        return bpool.getBalance(token);
    }

    function getDenormalizedWeight(address token) external view returns (uint) {
        return bpool.getDenormalizedWeight(token);
    }

    function getSwapFee() external view returns (uint) {
        return bpool.getSwapFee();
    }
}
