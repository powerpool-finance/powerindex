
pragma solidity 0.6.12;

import "./interfaces/WrappedPiErc20Interface.sol";
import "./interfaces/YearnGovernanceInterface.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./IPoolRestrictions.sol";
import "./PiSimpleRouter.sol";


contract PiRouter is PiSimpleRouter {
    using SafeMath for uint256;

    bytes4 public constant STAKE_SIG = bytes4(keccak256(bytes('stake(uint256)')));
    bytes4 public constant WITHDRAW_SIG = bytes4(keccak256(bytes('withdraw(uint256)')));
    bytes4 public constant VOTE_FOR_SIG = bytes4(keccak256(bytes('voteFor(uint256)')));
    bytes4 public constant VOTE_AGAINST_SIG = bytes4(keccak256(bytes('voteAgainst(uint256)')));

    event SetVotingForWrappedToken(address indexed wrappedToken, address indexed voting);
    event SetReserveRatioForWrappedToken(address indexed wrappedToken, uint ratio);

    mapping(address => uint) public reserveRatioByWrapped;
    mapping(address => address) public votingByWrapped;

    IPoolRestrictions public poolRestriction;

    constructor(address _poolRestrictions) public PiSimpleRouter() Ownable() {
        poolRestriction = IPoolRestrictions(_poolRestrictions);
    }

    function stakeWrappedToVoting(address _wrappedToken, uint256 _amount) external onlyOwner {
        _stakeWrappedToVoting(_wrappedToken, _amount);
    }

    function withdrawWrappedFromVoting(address _wrappedToken, uint256 _amount) external onlyOwner {
        _withdrawWrappedFromVoting(_wrappedToken, _amount);
    }

    function voteWrappedFor(address _wrappedToken, uint256 _id) external {
        _checkVotingSenderAllowed(_wrappedToken);
        _callVoting(_wrappedToken, VOTE_FOR_SIG, abi.encode(_id));
    }

    function voteWrappedAgainst(address _wrappedToken, uint256 _id) external {
        _checkVotingSenderAllowed(_wrappedToken);
        _callVoting(_wrappedToken, VOTE_AGAINST_SIG, abi.encode(_id));
    }

    function setVotingForWrappedToken(address _wrappedToken, address _voting) external onlyOwner {
        votingByWrapped[_wrappedToken] = _voting;
        emit SetVotingForWrappedToken(_wrappedToken, _voting);
    }

    function setReserveRatioForWrappedToken(address _wrappedToken, uint _reserveRatio) external onlyOwner {
        reserveRatioByWrapped[_wrappedToken] = _reserveRatio;
        emit SetReserveRatioForWrappedToken(_wrappedToken, _reserveRatio);
    }

    function wrapperCallback(uint256 _withdrawAmount) external override {
        address _wrappedToken = msg.sender;
        address votingAddress = votingByWrapped[_wrappedToken];

        // Ignore the tokens without a voting assigned
        if (votingByWrapped[_wrappedToken] == address(0)) {
            return;
        }

        YearnGovernanceInterface voting = YearnGovernanceInterface(votingByWrapped[_wrappedToken]);

        uint stakedBalance = voting.balanceOf(_wrappedToken);
        uint wrappedBalance = WrappedPiErc20Interface(_wrappedToken).getWrappedBalance();

        uint reserveAmount = reserveRatioByWrapped[_wrappedToken].mul(stakedBalance.add(wrappedBalance)).div(1 ether);

        reserveAmount = reserveAmount.add(_withdrawAmount);

        if (reserveAmount > wrappedBalance) {
            uint voteLockUntilBlock = voting.voteLock(_wrappedToken);
            if (voteLockUntilBlock < block.number) {
                _withdrawWrappedFromVoting(_wrappedToken, reserveAmount.sub(wrappedBalance));
            }
        } else if(wrappedBalance > reserveAmount) {
            _stakeWrappedToVoting(msg.sender, wrappedBalance.sub(reserveAmount));
        }
    }

    function _stakeWrappedToVoting(address _wrappedToken, uint256 _amount) internal {
        WrappedPiErc20Interface wrappedPi = WrappedPiErc20Interface(_wrappedToken);
        wrappedPi.approveToken(votingByWrapped[_wrappedToken], 0);
        wrappedPi.approveToken(votingByWrapped[_wrappedToken], _amount);
        _callVoting(_wrappedToken, STAKE_SIG, abi.encode(_amount));
    }

    function _withdrawWrappedFromVoting(address _wrappedToken, uint256 _amount) internal {
        _callVoting(_wrappedToken, WITHDRAW_SIG, abi.encode(_amount));
    }

    function _callVoting(address _wrappedToken, bytes4 _sig, bytes memory _data) internal {
        WrappedPiErc20Interface(_wrappedToken).callVoting(votingByWrapped[_wrappedToken], _sig, _data, 0);
    }

    function _checkVotingSenderAllowed(address _wrappedToken) internal {
        address voting = votingByWrapped[_wrappedToken];
        require(poolRestriction.isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
    }
}
