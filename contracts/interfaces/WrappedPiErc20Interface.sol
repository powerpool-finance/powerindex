
pragma solidity 0.6.12;

interface WrappedPiErc20Interface {
    function deposit(uint256 _amount) external virtual;

    function withdraw(uint256 _amount) external virtual;

    function changeRouter(address _newRouter) external virtual;

    function approveToken(address _to, uint256 _amount) external virtual;

    function callVoting(address voting, bytes4 signature, bytes calldata args, uint value) external virtual;
}