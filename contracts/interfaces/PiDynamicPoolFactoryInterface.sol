// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./PiDynamicPoolInterface.sol";

abstract contract PiDynamicPoolFactoryInterface {
    function newBPool(
        string calldata name,
        string calldata symbol,
        uint256 minWeightPerSecond,
        uint256 maxWeightPerSecond
    ) external virtual returns (PiDynamicPoolInterface);
}
