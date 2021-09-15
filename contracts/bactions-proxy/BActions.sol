// SPDX-License-Identifier: GPL-3.0
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

import "../interfaces/BPoolInterface.sol";
import "../interfaces/BFactoryInterface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/********************************** WARNING **********************************/
//                                                                           //
// This contract is only meant to be used in conjunction with ds-proxy.      //
// Calling this contract directly will lead to loss of funds.                //
//                                                                           //
/********************************** WARNING **********************************/

contract BActions {
    function create(
        BFactoryInterface factory,
        string calldata name,
        string calldata symbol,
        address[] calldata tokens,
        uint[] calldata balances,
        uint[] calldata denorms,
        uint[4] calldata fees,
        address communityFeeReceiver,
        bool finalize
    ) external returns (BPoolInterface pool) {
        require(tokens.length == balances.length, "ERR_LENGTH_MISMATCH");
        require(tokens.length == denorms.length, "ERR_LENGTH_MISMATCH");

        pool = factory.newBPool(name, symbol);
        pool.setSwapFee(fees[0]);
        pool.setCommunityFeeAndReceiver(fees[1], fees[2], fees[3], communityFeeReceiver);

        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            require(token.transferFrom(msg.sender, address(this), balances[i]), "ERR_TRANSFER_FAILED");
            if (token.allowance(address(this), address(pool)) > 0) {
                token.approve(address(pool), 0);
            }
            token.approve(address(pool), balances[i]);
            pool.bind(tokens[i], balances[i], denorms[i]);
        }

        if (finalize) {
            pool.finalize();
            require(pool.transfer(msg.sender, pool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
        }

        pool.setController(msg.sender);
    }

    function setTokens(
        BPoolInterface pool,
        address[] calldata tokens,
        uint[] calldata balances,
        uint[] calldata denorms
    ) external {
        require(tokens.length == balances.length, "ERR_LENGTH_MISMATCH");
        require(tokens.length == denorms.length, "ERR_LENGTH_MISMATCH");

        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            if (pool.isBound(tokens[i])) {
                if (balances[i] > pool.getBalance(tokens[i])) {
                    require(
                        token.transferFrom(msg.sender, address(this), balances[i] - pool.getBalance(tokens[i])),
                        "ERR_TRANSFER_FAILED"
                    );
                    if (token.allowance(address(this), address(pool)) > 0) {
                        token.approve(address(pool), 0);
                    }
                    token.approve(address(pool), balances[i] - pool.getBalance(tokens[i]));
                }
                if (balances[i] > 10**6) {
                    pool.rebind(tokens[i], balances[i], denorms[i]);
                } else {
                    pool.unbind(tokens[i]);
                }

            } else {
                require(token.transferFrom(msg.sender, address(this), balances[i]), "ERR_TRANSFER_FAILED");
                if (token.allowance(address(this), address(pool)) > 0) {
                    token.approve(address(pool), 0);
                }
                token.approve(address(pool), balances[i]);
                pool.bind(tokens[i], balances[i], denorms[i]);
            }

            if (token.balanceOf(address(this)) > 0) {
                require(token.transfer(msg.sender, token.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
            }

        }
    }

    function setSwapFee(BPoolInterface pool, uint newFee) external {
        pool.setSwapFee(newFee);
    }

    function setController(BPoolInterface pool, address newController) external {
        pool.setController(newController);
    }

    function finalize(BPoolInterface pool) external {
        pool.finalize();
        require(pool.transfer(msg.sender, pool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
    }

    function joinPool(
        BPoolInterface pool,
        uint poolAmountOut,
        uint[] calldata maxAmountsIn
    ) external {
        address[] memory tokens = pool.getFinalTokens();
        require(maxAmountsIn.length == tokens.length, "ERR_LENGTH_MISMATCH");

        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            require(token.transferFrom(msg.sender, address(this), maxAmountsIn[i]), "ERR_TRANSFER_FAILED");
            if (token.allowance(address(this), address(pool)) > 0) {
                token.approve(address(pool), 0);
            }
            token.approve(address(pool), maxAmountsIn[i]);
        }
        pool.joinPool(poolAmountOut, maxAmountsIn);
        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = IERC20(tokens[i]);
            if (token.balanceOf(address(this)) > 0) {
                require(token.transfer(msg.sender, token.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
            }
        }
        require(pool.transfer(msg.sender, pool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
    }

    function joinswapExternAmountIn(
        BPoolInterface pool,
        address tokenIn,
        uint tokenAmountIn,
        uint minPoolAmountOut
    ) external {
        IERC20 token = IERC20(tokenIn);
        require(token.transferFrom(msg.sender, address(this), tokenAmountIn), "ERR_TRANSFER_FAILED");
        if (token.allowance(address(this), address(pool)) > 0) {
            token.approve(address(pool), 0);
        }
        token.approve(address(pool), tokenAmountIn);
        uint poolAmountOut = pool.joinswapExternAmountIn(tokenIn, tokenAmountIn, minPoolAmountOut);
        require(pool.transfer(msg.sender, poolAmountOut), "ERR_TRANSFER_FAILED");
    }
}
