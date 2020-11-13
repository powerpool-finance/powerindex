// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../lib/SafeMath96.sol";

contract MockSafeMath96 {
  using SafeMath96 for uint96;

  function add(uint96 a, uint96 b) public pure returns (uint96) {
    return SafeMath96.add(a, b);
  }

  function sub(uint96 a, uint96 b) public pure returns (uint96) {
    return SafeMath96.sub(a, b);
  }

  function average(uint96 a, uint96 b) public pure returns (uint256) {
    return SafeMath96.average(a, b);
  }

  function fromUint(uint256 n) public pure returns (uint96) {
    return SafeMath96.fromUint(n);
  }
}
