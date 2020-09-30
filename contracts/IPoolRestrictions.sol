pragma solidity 0.6.12;


interface IPoolRestrictions {
    function getMaxTotalSupply(address _pool) external virtual view returns(uint256);
    function isVotingSignatureAllowed(address _votingAddress, bytes4 _signature) external virtual view returns(bool);
}