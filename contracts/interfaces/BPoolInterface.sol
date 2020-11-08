// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface BPoolInterface {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address spender, address recipient, uint256 amount) external returns (bool);

    function joinPool(uint poolAmountOut, uint[] calldata maxAmountsIn) external;
    function exitPool(uint poolAmountIn, uint[] calldata minAmountsOut) external;
    function swapExactAmountIn(address, uint, address, uint, uint) external returns (uint, uint);
    function swapExactAmountOut(address, uint, address, uint, uint) external returns (uint, uint);
    function joinswapExternAmountIn(address, uint, uint) external returns (uint);
    function joinswapPoolAmountOut(address, uint, uint) external returns (uint);
    function exitswapPoolAmountIn(address, uint, uint) external returns (uint);
    function exitswapExternAmountOut(address, uint, uint) external returns (uint);
    function calcInGivenOut(uint, uint, uint, uint, uint, uint) external pure returns (uint);
    function getDenormalizedWeight(address) external view returns (uint);
    function getBalance(address) external view returns (uint);
    function getSwapFee() external view returns (uint);
    function totalSupply() external view returns (uint);
    function balanceOf(address) external view returns (uint);
    function getTotalDenormalizedWeight() external view returns (uint);

    function getCommunityFee() external view returns (uint, uint, uint, address);
    function calcAmountWithCommunityFee(uint, uint, address) external view returns (uint, uint);
    function getRestrictions() external view returns (address);

    function isBound(address t) external view returns (bool);
    function getCurrentTokens() external view returns (address[] memory tokens);
    function getFinalTokens() external view returns (address[] memory tokens);

    function setSwapFee(uint) external;
    function setCommunityFeeAndReceiver(uint, uint, uint, address) external;
    function setController(address) external;
    function setPublicSwap(bool) external;
    function finalize() external;
    function bind(address, uint, uint) external;
    function rebind(address, uint, uint) external;
    function unbind(address) external;
    function callVoting(address voting, bytes4 signature, bytes calldata args, uint256 value) external;

    function MIN_WEIGHT() external view returns (uint);
}
