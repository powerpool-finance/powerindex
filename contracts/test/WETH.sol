pragma solidity 0.6.12;

import "../balancer-core/test/TToken.sol";

contract WETH is TToken {
    event Deposit(address indexed dst, uint wad);
    event Withdrawal(address indexed src, uint wad);

    constructor() public TToken("WETH", "WETH", 18) {}

    function deposit() public payable {
        _mint(msg.sender, msg.value * 10e3);
        Deposit(msg.sender, msg.value * 10e3);
    }
    function withdraw(uint wad) public {
        burn(wad);
        msg.sender.transfer(wad / 10e3);
        Withdrawal(msg.sender, wad / 10e3);
    }
}