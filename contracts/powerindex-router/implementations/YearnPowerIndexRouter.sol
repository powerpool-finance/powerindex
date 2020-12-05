// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../interfaces/WrappedPiErc20Interface.sol";
import "../../interfaces/YearnGovernanceInterface.sol";
import "./../PowerIndexBasicRouter.sol";

contract YearnPowerIndexRouter is PowerIndexBasicRouter {
  bytes4 public constant REGISTER_SIG = bytes4(keccak256(bytes("register()")));
  bytes4 public constant EXIT_SIG = bytes4(keccak256(bytes("exit()")));
  bytes4 public constant PROPOSE_SIG = bytes4(keccak256(bytes("propose(address,string)")));
  bytes4 public constant STAKE_SIG = bytes4(keccak256(bytes("stake(uint256)")));
  bytes4 public constant WITHDRAW_SIG = bytes4(keccak256(bytes("withdraw(uint256)")));
  bytes4 public constant VOTE_FOR_SIG = bytes4(keccak256(bytes("voteFor(uint256)")));
  bytes4 public constant VOTE_AGAINST_SIG = bytes4(keccak256(bytes("voteAgainst(uint256)")));

  constructor(address _wrappedToken, address _poolRestrictions) public PowerIndexBasicRouter(_wrappedToken, _poolRestrictions) {}

  /*** THE PROXIED METHOD EXECUTORS ***/

  function executeRegister() external {
    _checkVotingSenderAllowed();
    _callVoting(REGISTER_SIG, "");
  }

  function executeExit() external {
    _checkVotingSenderAllowed();
    _callVoting(EXIT_SIG, "");
  }

  function executePropose(
    address _executor,
    string calldata _hash
  ) external {
    _checkVotingSenderAllowed();
    _callVoting(PROPOSE_SIG, abi.encode(_executor, _hash));
  }

  function executeVoteFor(uint256 _id) external {
    _checkVotingSenderAllowed();
    _callVoting(VOTE_FOR_SIG, abi.encode(_id));
  }

  function executeVoteAgainst(uint256 _id) external {
    _checkVotingSenderAllowed();
    _callVoting(VOTE_AGAINST_SIG, abi.encode(_id));
  }

  /*** OWNER METHODS ***/

  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  function redeem(uint256 _amount) external onlyOwner {
    _redeem(_amount);
  }

  /*** WRAPPED TOKEN CALLBACK ***/

  function wrapperCallback(uint256 _withdrawAmount) external override {
    address wrappedToken_ = msg.sender;

    // Ignore the tokens without a voting assigned
    if (voting == address(0)) {
      return;
    }

    YearnGovernanceInterface _voting = YearnGovernanceInterface(voting);
    (ReserveStatus status, uint256 diff, ) =
      _getReserveStatus(_voting.balanceOf(wrappedToken_), _withdrawAmount);

    if (status == ReserveStatus.ABOVE) {
      uint256 voteLockUntilBlock = _voting.voteLock(wrappedToken_);
      if (voteLockUntilBlock < block.number) {
        _redeem(diff);
      }
    } else if (status == ReserveStatus.BELLOW) {
      _stake(diff);
    }
  }

  /*** INTERNALS ***/

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");
    wrappedToken.approveToken(voting, _amount);
    _callVoting(STAKE_SIG, abi.encode(_amount));
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_WITHDRAW_0");
    _callVoting(WITHDRAW_SIG, abi.encode(_amount));
  }
}
