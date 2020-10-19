pragma solidity 0.6.12;

/// @dev Slots reserved for possible storage layout changes (it neither spends gas nor adds extra bytecode)
contract ReservedSlots {
    uint256[100] private __gap;
}
