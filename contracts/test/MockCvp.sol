// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MockERC20.sol";

contract MockCvp is MockERC20 {
  mapping(address => mapping(address => uint256)) public delegated;

  constructor() public MockERC20("TCVP", "Test Concentrated Voting Power", 100000000e18) {}

  function getPriorVotes(address _addr) external view returns (uint96) {
    return uint96(balanceOf(_addr));
  }

  function delegate(address _addr) external {
    delegated[msg.sender][_addr] = balanceOf(msg.sender);
  }
}
