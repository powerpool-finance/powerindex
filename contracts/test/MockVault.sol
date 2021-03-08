// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MockERC20.sol";

contract MockVault is MockERC20 {
  uint256 public balance;

  constructor(uint256 _balance, uint256 _supply) public MockERC20("", "", 18, _supply) {
    balance = _balance;
  }

  function setBalance(uint256 _balance) public {
    balance = _balance;
  }
}
