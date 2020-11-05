pragma solidity 0.6.12;

abstract contract BPoolInterface {
    function approve(address spender, uint256 amount) external virtual returns (bool);
    function transfer(address recipient, uint256 amount) external virtual returns (bool);
    function transferFrom(address spender, address recipient, uint256 amount) external virtual returns (bool);

    function joinPool(uint poolAmountOut, uint[] calldata maxAmountsIn) external virtual;
    function exitPool(uint poolAmountIn, uint[] calldata minAmountsOut) external virtual;
    function swapExactAmountIn(address, uint, address, uint, uint) external virtual returns (uint, uint);
    function swapExactAmountOut(address, uint, address, uint, uint) external virtual returns (uint, uint);
    function joinswapExternAmountIn(address, uint, uint) external virtual returns (uint);
    function joinswapPoolAmountOut(address, uint, uint) external virtual returns (uint);
    function exitswapPoolAmountIn(address, uint, uint) external virtual returns (uint);
    function exitswapExternAmountOut(address, uint, uint) external virtual returns (uint);
    function calcInGivenOut(uint, uint, uint, uint, uint, uint) public pure virtual returns (uint);
    function getDenormalizedWeight(address) external view virtual returns (uint);
    function getBalance(address) external view virtual returns (uint);
    function getSwapFee() external view virtual returns (uint);
    function totalSupply() external view virtual returns (uint);
    function balanceOf(address) external view virtual returns (uint);
    function getTotalDenormalizedWeight() external view virtual returns (uint);

    function getCommunityFee() external view virtual returns (uint, uint, uint, address);
    function calcAmountWithCommunityFee(uint, uint, address) external view virtual returns (uint, uint);
    function getRestrictions() external view virtual returns (address);

    function isBound(address t) external view virtual returns (bool);
    function getCurrentTokens() external view virtual returns (address[] memory tokens);
    function getFinalTokens() external view virtual returns (address[] memory tokens);

    function setSwapFee(uint) external virtual;
    function setCommunityFeeAndReceiver(uint, uint, uint, address) external virtual;
    function setController(address) external virtual;
    function setPublicSwap(bool) external virtual;
    function finalize() external virtual;
    function bind(address, uint, uint) external virtual;
    function rebind(address, uint, uint) external virtual;
    function unbind(address) external virtual;
    function callVoting(address voting, bytes4 signature, bytes calldata args, uint value) external virtual;

    function MIN_WEIGHT() external view virtual returns (uint);
}