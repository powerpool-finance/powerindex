// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./PowerIndexPoolInterface.sol";

interface PowerIndexPoolFactoryInterface {
  function newPool(
    string calldata name,
    string calldata symbol,
    uint256 minWeightPerSecond,
    uint256 maxWeightPerSecond
  ) external virtual returns (PowerIndexPoolInterface);
}
