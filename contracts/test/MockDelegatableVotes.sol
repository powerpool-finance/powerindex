pragma solidity 0.6.12;

import "../DelegatableVotes.sol";

contract MockDelegatableVotes is DelegatableVotes {

    function __writeUserData(address account, uint192 data) public {
        _writeUserData(account, data);
    }

    function __writeSharedData(uint192 data) public {
        _writeSharedData(data);
    }

    function __moveUserData(address account, address from, address to) public {
        _moveUserData(account, from, to);
    }

    function __computeUserData(uint192 prevData, uint192 newDelegated, uint192 prevDelegated)
    internal pure virtual returns (uint192 userData)
    {
        return _computeUserData(prevData, newDelegated, prevDelegated);
    }

    function _computeUserVotes(uint192 userData, uint192 sharedData)
    internal override pure returns (uint96 votes)
    {
        votes = uint96(userData + sharedData);
    }
}
