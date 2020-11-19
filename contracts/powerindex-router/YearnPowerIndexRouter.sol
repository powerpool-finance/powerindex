// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/YearnGovernanceInterface.sol";
import "./PowerIndexSimpleRouter.sol";

contract YearnPowerIndexRouter is PowerIndexSimpleRouter {
  bytes4 public constant REGISTER_SIG = bytes4(keccak256(bytes("register()")));
  bytes4 public constant EXIT_SIG = bytes4(keccak256(bytes("exit()")));
  bytes4 public constant PROPOSE_SIG = bytes4(keccak256(bytes("propose(address,string)")));
  bytes4 public constant STAKE_SIG = bytes4(keccak256(bytes("stake(uint256)")));
  bytes4 public constant WITHDRAW_SIG = bytes4(keccak256(bytes("withdraw(uint256)")));
  bytes4 public constant VOTE_FOR_SIG = bytes4(keccak256(bytes("voteFor(uint256)")));
  bytes4 public constant VOTE_AGAINST_SIG = bytes4(keccak256(bytes("voteAgainst(uint256)")));

  constructor(address _poolRestrictions) public PowerIndexSimpleRouter(_poolRestrictions) {}

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

  /*** WRAPPED TOKEN CALLBACK ***/

  function wrapperCallback(uint256 _withdrawAmount) external override {
    address wrappedToken = msg.sender;
    address votingAddress = votingByWrapped[wrappedToken];

    // Ignore the tokens without a voting assigned
    if (votingAddress == address(0)) {
      return;
    }

    YearnGovernanceInterface voting = YearnGovernanceInterface(votingAddress);
    (ReserveStatus status, uint256 diff, ) =
      _getReserveStatus(wrappedToken, voting.balanceOf(wrappedToken), _withdrawAmount);

    if (status == ReserveStatus.ABOVE) {
      uint256 voteLockUntilBlock = voting.voteLock(wrappedToken);
      if (voteLockUntilBlock < block.number) {
        _withdrawWrappedFromVoting(wrappedToken, diff);
      }
    } else if (status == ReserveStatus.BELLOW) {
      _stakeWrappedToVoting(msg.sender, diff);
    }
  }

  /*** INTERNALS ***/

  function _stakeWrappedToVoting(address _wrappedToken, uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");
    _approveWrappedTokenToVoting(_wrappedToken, _amount);
    _callVoting(_wrappedToken, STAKE_SIG, abi.encode(_amount));
  }

  function _withdrawWrappedFromVoting(address _wrappedToken, uint256 _amount) internal {
    require(_amount > 0, "CANT_WITHDRAW_0");
    _callVoting(_wrappedToken, WITHDRAW_SIG, abi.encode(_amount));
  }
}
