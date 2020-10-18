pragma solidity 0.6.12;

abstract contract BPoolInterface {
    function swapExactAmountIn(address, uint, address, uint, uint) external virtual returns (uint, uint);
    function swapExactAmountOut(address, uint, address, uint, uint) external virtual returns (uint, uint);
    function calcInGivenOut(uint, uint, uint, uint, uint, uint) public pure virtual returns (uint);
    function getDenormalizedWeight(address) external view virtual returns (uint);
    function getBalance(address) external view virtual returns (uint);
    function getSwapFee() external view virtual returns (uint);

    function getCurrentTokens() external view returns (address[] memory tokens);
}