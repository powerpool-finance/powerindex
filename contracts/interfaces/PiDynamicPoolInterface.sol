// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./BPoolInterface.sol";

abstract contract PiDynamicPoolInterface is BPoolInterface {
    function bind(address, uint, uint, uint, uint) external virtual;

    function setDynamicWeight(
        address token,
        uint targetDenorm,
        uint fromTimestamp,
        uint targetTimestamp
    ) external virtual;

    function getDynamicWeightSettings(address token) external virtual view returns (
        uint fromTimestamp,
        uint targetTimestamp,
        uint fromDenorm,
        uint targetDenorm
    );
}
