pragma solidity 0.6.12;

abstract contract BPoolInterface {
    function transfer(address recipient, uint256 amount) external virtual returns (bool);

    function joinPool(uint poolAmountOut, uint[] calldata maxAmountsIn) external virtual;
    function swapExactAmountIn(address, uint, address, uint, uint) external virtual returns (uint, uint);
    function swapExactAmountOut(address, uint, address, uint, uint) external virtual returns (uint, uint);
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

    function getCurrentTokens() external view virtual returns (address[] memory tokens);
}