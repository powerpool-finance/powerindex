// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./PowerIndexPoolInterface.sol";

interface PowerIndexPoolFactoryInterface {
  function newPool(
    string calldata _name,
    string calldata _symbol,
    address _controller,
    uint256 _minWeightPerSecond,
    uint256 _maxWeightPerSecond
  ) external returns (PowerIndexPoolInterface);
}
