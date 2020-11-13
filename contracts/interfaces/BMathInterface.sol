// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


interface BMathInterface {
    function calcInGivenOut(
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint tokenAmountOut,
        uint swapFee
    )
    external pure
    returns (uint tokenAmountIn);
}
