// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/IPoolRestrictions.sol";
import "../interfaces/PowerIndexBasicRouterInterface.sol";
import "./PowerIndexNaiveRouter.sol";
import "hardhat/console.sol";

contract PowerIndexBasicRouter is PowerIndexBasicRouterInterface, PowerIndexNaiveRouter {
  uint256 public constant HUNDRED_PCT = 1 ether;

  event SetVotingAndStaking(address indexed voting, address indexed staking);
  event SetReserveRatio(uint256 ratio);

  enum ReserveStatus { EQUAL, ABOVE, BELLOW }

  WrappedPiErc20Interface public immutable wrappedToken;

  IPoolRestrictions public poolRestriction;
  address public voting;
  address public staking;
  uint256 public reserveRatio;

  constructor(address _wrappedToken, address _poolRestrictions) public PowerIndexNaiveRouter() Ownable() {
    wrappedToken = WrappedPiErc20Interface(_wrappedToken);
    poolRestriction = IPoolRestrictions(_poolRestrictions);
  }

  function setVotingAndStaking(address _voting, address _staking) external override onlyOwner {
    voting = _voting;
    staking = _staking;
    emit SetVotingAndStaking(_voting, _staking);
  }

  function setReserveRatio(uint256 _reserveRatio) external onlyOwner {
    require(_reserveRatio <= 1 ether, "GREATER_THAN_100_PCT");
    reserveRatio = _reserveRatio;
    emit SetReserveRatio(_reserveRatio);
  }

  function _callVoting(bytes4 _sig, bytes memory _data) internal {
    wrappedToken.callExternal(voting, _sig, _data, 0);
  }

  function _callStaking(bytes4 _sig, bytes memory _data) internal {
    wrappedToken.callExternal(staking, _sig, _data, 0);
  }

  function _checkVotingSenderAllowed() internal view {
    require(poolRestriction.isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
  }

  function _getReserveStatus(uint256 _stakedBalance, uint256 _withdrawAmount)
    internal
    view
    returns (
      ReserveStatus status,
      uint256 diff,
      uint256 reserveAmount
    )
  {
    uint256 wrappedBalance = wrappedToken.getWrappedBalance();

    uint256 _reserveAmount = reserveRatio.mul(_stakedBalance.add(wrappedBalance)).div(HUNDRED_PCT);

    reserveAmount = _reserveAmount.add(_withdrawAmount);

    if (reserveAmount > wrappedBalance) {
      status = ReserveStatus.ABOVE;
      diff = reserveAmount.sub(wrappedBalance);
    } else if (reserveAmount < wrappedBalance) {
      status = ReserveStatus.BELLOW;
      diff = wrappedBalance.sub(reserveAmount);
    } else {
      status = ReserveStatus.EQUAL;
      diff = 0;
    }
  }

  function _approveWrappedTokenToStaking(uint256 _amount) internal {
    wrappedToken.approveToken(staking, _amount);
  }

  function _approveWrappedTokenToVoting(uint256 _amount) internal {
    wrappedToken.approveToken(voting, _amount);
  }
}
