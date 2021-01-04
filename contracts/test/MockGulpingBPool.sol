// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract MockGulpingBPool {
  event Gulp();

  function gulp(address) external {
    emit Gulp();
  }
}
