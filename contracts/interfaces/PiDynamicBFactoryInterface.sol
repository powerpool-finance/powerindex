pragma solidity 0.6.12;

import "./PiDynamicBPoolInterface.sol";

abstract contract PiDynamicBFactoryInterface {
    function newBPool(string calldata name, string calldata symbol) external virtual returns (PiDynamicBPoolInterface);
}