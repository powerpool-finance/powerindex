pragma solidity 0.6.12;

import "./BPoolInterface.sol";

abstract contract PiDynamicBPoolInterface is BPoolInterface {
    function bind(address, uint, uint, uint, uint, uint) external virtual;
}