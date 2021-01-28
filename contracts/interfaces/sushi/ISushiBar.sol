// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

interface ISushiBar {
  function enter(uint256 _amount) external;

  function leave(uint256 _amount) external;
}
