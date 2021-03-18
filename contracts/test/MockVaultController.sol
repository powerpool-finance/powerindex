// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

contract MockYController {
  mapping(address => uint256) public balanceOf;

  function setBalanceOf(address _of, uint256 _balance) external {
    balanceOf[_of] = _balance;
  }
}
