// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MockERC20.sol";

contract MockVault is MockERC20 {
  uint256 public balance;
  IERC20 public token;

  constructor(address _token, uint256 _balance, uint256 _supply) public MockERC20("", "", 18, _supply) {
    token = IERC20(_token);
    balance = _balance;
  }

  function deposit(uint256 _amount) public {
    token.transferFrom(msg.sender, address(this), _amount);
    mint(msg.sender, _amount.mul(1 ether).div(getPricePerFullShare()));
  }

  function withdraw(uint256 _amount) public {
    burn(_amount);
    token.transfer(msg.sender, _amount.mul(getPricePerFullShare()).div(1 ether));
  }

  function setBalance(uint256 _balance) public {
    balance = _balance;
  }

  function getPricePerFullShare() public view returns (uint256) {
    return balance.mul(1e18).div(totalSupply());
  }
}
