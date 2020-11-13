// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../lib/SafeMath32.sol";

contract MockSafeMath32 {
  using SafeMath32 for uint32;

  function add(uint32 a, uint32 b) public pure returns (uint32) {
    return SafeMath32.add(a, b);
  }

  function sub(uint32 a, uint32 b) public pure returns (uint32) {
    return SafeMath32.sub(a, b);
  }

  function fromUint(uint256 n) public pure returns (uint32) {
    return SafeMath32.fromUint(n);
  }
}
