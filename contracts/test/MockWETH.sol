pragma solidity 0.6.12;

import "../balancer-core/test/TToken.sol";

contract MockWETH is TToken {
    event Deposit(address indexed dst, uint wad);
    event Withdrawal(address indexed src, uint wad);

    uint256 public multiplier;

    constructor(uint256 _multiplier) public TToken("WETH", "WETH", 18) {
        multiplier = _multiplier;
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value * multiplier);
        Deposit(msg.sender, msg.value * multiplier);
    }
    function withdraw(uint wad) public {
        burn(wad);
        msg.sender.transfer(wad / multiplier);
        Withdrawal(msg.sender, wad / multiplier);
    }
}