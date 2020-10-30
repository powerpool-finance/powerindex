
pragma solidity 0.6.12;

import "./interfaces/WrappedPiErc20Interface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract PiRouter is Ownable {
    bytes4 private constant STAKE_SIG = bytes4(keccak256(bytes('transfer(uint256)')));
    bytes4 private constant WITHDRAW_SIG = bytes4(keccak256(bytes('withdraw(uint256)')));
    bytes4 private constant VOTE_FOR_SIG = bytes4(keccak256(bytes('voteFor(uint256)')));
    bytes4 private constant VOTE_AGAINST_SIG = bytes4(keccak256(bytes('voteAgainst(uint256)')));

    constructor() public {}

    function stakeWrappedToVoting(address _wrappedToken, address _voting, uint256 _amount) external onlyOwner {
        WrappedPiErc20Interface wrappedPi = WrappedPiErc20Interface(_wrappedToken);
        wrappedPi.approveToken(_voting, 0);
        wrappedPi.approveToken(_voting, _amount);
        _callVoting(_wrappedToken, _voting, STAKE_SIG, abi.encode(_amount));
    }

    function withdrawWrappedFromVoting(address _wrappedToken, address _voting, uint256 _amount) external onlyOwner {
        _callVoting(_wrappedToken, _voting, WITHDRAW_SIG, abi.encode(_amount));
    }

    function voteWrappedFor(address _wrappedToken, address _voting, uint256 _id) external onlyOwner {
        _callVoting(_wrappedToken, _voting, VOTE_FOR_SIG, abi.encode(_id));
    }

    function voteWrappedAgainst(address _wrappedToken, address _voting, uint256 _id) external onlyOwner {
        _callVoting(_wrappedToken, _voting, VOTE_AGAINST_SIG, abi.encode(_id));
    }

    function migrateWrappedTokensToNewRouter(address[] calldata _wrappedTokens, address _newRouter) external onlyOwner {
        uint256 len = _wrappedTokens.length;
        for(uint256 i = 0; i < len; i++) {
            WrappedPiErc20Interface(_wrappedTokens[i]).changeRouter(_newRouter);
        }
    }

    function _callVoting(address _wrappedToken, address _voting, bytes4 _sig, bytes memory _data) internal {
        WrappedPiErc20Interface(_wrappedToken).callVoting(_voting, _sig, _data, 0);
    }
}