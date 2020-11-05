
pragma solidity 0.6.12;

interface PiRouterInterface {
    function wrapperCallback(uint) external;
    function setVotingForWrappedToken(address _wrappedToken, address _voting) external;
}
