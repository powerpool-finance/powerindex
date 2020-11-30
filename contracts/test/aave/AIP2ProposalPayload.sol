// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../../interfaces/PowerIndexBasicRouterInterface.sol";

contract AIP2ProposalPayload {
  event ProposalExecuted(address caller);
  function execute() external {
    bytes32 value = bytes32(uint256(42));
    assembly {
      sstore(0x3333, value)
    }
    emit ProposalExecuted(msg.sender);
  }
}
