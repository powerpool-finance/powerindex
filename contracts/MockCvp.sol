pragma solidity 0.6.12;


import "./MockERC20.sol";


contract MockCvp is MockERC20 {
    constructor() public MockERC20('TCVP', 'Test Concentrated Voting Power', 100000000e18) {

    }
}