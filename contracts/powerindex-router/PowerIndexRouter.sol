// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/YearnGovernanceInterface.sol";
import "../interfaces/IPoolRestrictions.sol";
import "./PowerIndexSimpleRouter.sol";

contract PowerIndexRouter is PowerIndexSimpleRouter {
  using SafeMath for uint256;

  bytes4 public constant REGISTER_SIG = bytes4(keccak256(bytes("register()")));
  bytes4 public constant EXIT_SIG = bytes4(keccak256(bytes("exit()")));
  bytes4 public constant PROPOSE_SIG = bytes4(keccak256(bytes("propose(address,string)")));
  bytes4 public constant STAKE_SIG = bytes4(keccak256(bytes("stake(uint256)")));
  bytes4 public constant WITHDRAW_SIG = bytes4(keccak256(bytes("withdraw(uint256)")));
  bytes4 public constant VOTE_FOR_SIG = bytes4(keccak256(bytes("voteFor(uint256)")));
  bytes4 public constant VOTE_AGAINST_SIG = bytes4(keccak256(bytes("voteAgainst(uint256)")));

  event SetVotingForWrappedToken(address indexed wrappedToken, address indexed voting);
  event SetReserveRatioForWrappedToken(address indexed wrappedToken, uint256 ratio);

  mapping(address => uint256) public reserveRatioByWrapped;
  mapping(address => address) public votingByWrapped;

  IPoolRestrictions public poolRestriction;

  constructor(address _poolRestrictions) public PowerIndexSimpleRouter() Ownable() {
    poolRestriction = IPoolRestrictions(_poolRestrictions);
  }

  /*** THE PROXIED METHOD EXECUTORS ***/

  function executeRegister(address _wrappedToken) external {
    _checkVotingSenderAllowed(_wrappedToken);
    _callVoting(_wrappedToken, REGISTER_SIG, "");
  }

  function executeExit(address _wrappedToken) external {
    _checkVotingSenderAllowed(_wrappedToken);
    _callVoting(_wrappedToken, EXIT_SIG, "");
  }

  function executePropose(
    address _wrappedToken,
    address _executor,
    string calldata _hash
  ) external {
    _checkVotingSenderAllowed(_wrappedToken);
    _callVoting(_wrappedToken, PROPOSE_SIG, abi.encode(_executor, _hash));
  }

  function executeVoteFor(address _wrappedToken, uint256 _id) external {
    _checkVotingSenderAllowed(_wrappedToken);
    _callVoting(_wrappedToken, VOTE_FOR_SIG, abi.encode(_id));
  }

  function executeVoteAgainst(address _wrappedToken, uint256 _id) external {
    _checkVotingSenderAllowed(_wrappedToken);
    _callVoting(_wrappedToken, VOTE_AGAINST_SIG, abi.encode(_id));
  }

  /*** OWNER METHODS ***/

  function stakeWrappedToVoting(address _wrappedToken, uint256 _amount) external onlyOwner {
    _stakeWrappedToVoting(_wrappedToken, _amount);
  }

  function withdrawWrappedFromVoting(address _wrappedToken, uint256 _amount) external onlyOwner {
    _withdrawWrappedFromVoting(_wrappedToken, _amount);
  }

  function setVotingForWrappedToken(address _wrappedToken, address _voting) external onlyOwner {
    votingByWrapped[_wrappedToken] = _voting;
    emit SetVotingForWrappedToken(_wrappedToken, _voting);
  }

  function setReserveRatioForWrappedToken(address _wrappedToken, uint256 _reserveRatio) external onlyOwner {
    require(_reserveRatio <= 1 ether, "GREATER_THAN_100_PCT");
    reserveRatioByWrapped[_wrappedToken] = _reserveRatio;
    emit SetReserveRatioForWrappedToken(_wrappedToken, _reserveRatio);
  }

  /*** WRAPPED TOKEN CALLBACK ***/

  function wrapperCallback(uint256 _withdrawAmount) external override {
    address _wrappedToken = msg.sender;
    address votingAddress = votingByWrapped[_wrappedToken];

    // Ignore the tokens without a voting assigned
    if (votingAddress == address(0)) {
      return;
    }

    YearnGovernanceInterface voting = YearnGovernanceInterface(votingAddress);

    uint256 stakedBalance = voting.balanceOf(_wrappedToken);
    uint256 wrappedBalance = WrappedPiErc20Interface(_wrappedToken).getWrappedBalance();

    uint256 reserveAmount = reserveRatioByWrapped[_wrappedToken].mul(stakedBalance.add(wrappedBalance)).div(1 ether);

    reserveAmount = reserveAmount.add(_withdrawAmount);

    if (reserveAmount > wrappedBalance) {
      uint256 voteLockUntilBlock = voting.voteLock(_wrappedToken);
      if (voteLockUntilBlock < block.number) {
        _withdrawWrappedFromVoting(_wrappedToken, reserveAmount.sub(wrappedBalance));
      }
    } else if (wrappedBalance > reserveAmount) {
      _stakeWrappedToVoting(msg.sender, wrappedBalance.sub(reserveAmount));
    }
  }

  /*** INTERNALS ***/

  function _stakeWrappedToVoting(address _wrappedToken, uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");
    WrappedPiErc20Interface wrappedPi = WrappedPiErc20Interface(_wrappedToken);
    wrappedPi.approveToken(votingByWrapped[_wrappedToken], _amount);
    _callVoting(_wrappedToken, STAKE_SIG, abi.encode(_amount));
  }

  function _withdrawWrappedFromVoting(address _wrappedToken, uint256 _amount) internal {
    require(_amount > 0, "CANT_WITHDRAW_0");
    _callVoting(_wrappedToken, WITHDRAW_SIG, abi.encode(_amount));
  }

  function _callVoting(
    address _wrappedToken,
    bytes4 _sig,
    bytes memory _data
  ) internal {
    WrappedPiErc20Interface(_wrappedToken).callVoting(votingByWrapped[_wrappedToken], _sig, _data, 0);
  }

  function _checkVotingSenderAllowed(address _wrappedToken) internal view {
    address voting = votingByWrapped[_wrappedToken];
    require(poolRestriction.isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
  }
}
