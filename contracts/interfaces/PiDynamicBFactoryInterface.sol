// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./PiDynamicBPoolInterface.sol";

abstract contract PiDynamicBFactoryInterface {
    function newBPool(
        string calldata name,
        string calldata symbol,
        uint256 minWeightPerSecond,
        uint256 maxWeightPerSecond
    ) external virtual returns (PiDynamicBPoolInterface);
}
