// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../powerindex-mining/VestedLPMining.sol";

contract MockVestedLPMiningClient {
  function callMiningTwice(
    VestedLPMining lpMining,
    IERC20 token,
    uint256 poolId,
    uint256 amount
  ) external payable {
    token.transferFrom(msg.sender, address(this), amount);
    token.approve(address(lpMining), amount);

    lpMining.deposit(poolId, amount, 0);

    lpMining.withdraw(poolId, amount, 0);
  }
}
