// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./BPoolInterface.sol";

interface BFactoryInterface {
  function newBPool(string calldata name, string calldata symbol) external virtual returns (BPoolInterface);
}
