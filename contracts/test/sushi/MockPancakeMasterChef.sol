// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract MockPancakeMasterChef {
  function enterStaking(uint256) external {}

  function leaveStaking(uint256) external {}

  function userInfo(uint256, address) external view returns (uint256 amount, uint256 rewardDebt) {
    return (0, 0);
  }
}
