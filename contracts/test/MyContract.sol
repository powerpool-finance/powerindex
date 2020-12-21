// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";

contract MyContract is Ownable {
  uint256 internal theAnswer;

  constructor() public Ownable() {
  }

  function setAnswer(uint256 _theAnswer) external view {
//    theAnswer = _theAnswer;
  }

  function getAnswer() external view returns (uint256) {
    return theAnswer;
  }
}
