// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

interface IAave {
  function getPowerCurrent(address user, uint8 delegationType)
    external
    view
    returns (uint256);
}
