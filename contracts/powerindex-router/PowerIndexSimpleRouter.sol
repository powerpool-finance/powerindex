// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/IPoolRestrictions.sol";
import "./PowerIndexNaiveRouter.sol";

contract PowerIndexSimpleRouter is PowerIndexNaiveRouter {
  mapping(address => uint256) public reserveRatioByWrapped;
  mapping(address => address) public votingByWrapped;
  mapping(address => address) public stackingByWrapped;

  IPoolRestrictions public poolRestriction;

  enum ReserveStatus { EQUAL, ABOVE, BELLOW }

  event SetVotingAndStackingForWrappedToken(
    address indexed wrappedToken,
    address indexed voting,
    address indexed stacking
  );
  event SetReserveRatioForWrappedToken(address indexed wrappedToken, uint256 ratio);

  constructor(address _poolRestrictions) public PowerIndexNaiveRouter() Ownable() {
    poolRestriction = IPoolRestrictions(_poolRestrictions);
  }

  function setVotingAndStackingForWrappedToken(
    address _wrappedToken,
    address _voting,
    address _stacking
  ) external onlyOwner {
    votingByWrapped[_wrappedToken] = _voting;
    stackingByWrapped[_wrappedToken] = _stacking;
    emit SetVotingAndStackingForWrappedToken(_wrappedToken, _voting, _stacking);
  }

  function setReserveRatioForWrappedToken(address _wrappedToken, uint256 _reserveRatio) external onlyOwner {
    require(_reserveRatio <= 1 ether, "GREATER_THAN_100_PCT");
    reserveRatioByWrapped[_wrappedToken] = _reserveRatio;
    emit SetReserveRatioForWrappedToken(_wrappedToken, _reserveRatio);
  }

  function _callVoting(
    address _wrappedToken,
    bytes4 _sig,
    bytes memory _data
  ) internal {
    WrappedPiErc20Interface(_wrappedToken).callVoting(votingByWrapped[_wrappedToken], _sig, _data, 0);
  }

  function _callStacking(
    address _wrappedToken,
    bytes4 _sig,
    bytes memory _data
  ) internal {
    WrappedPiErc20Interface(_wrappedToken).callVoting(stackingByWrapped[_wrappedToken], _sig, _data, 0);
  }

  function _checkVotingSenderAllowed(address _wrappedToken) internal view {
    address voting = votingByWrapped[_wrappedToken];
    require(poolRestriction.isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
  }

  function _getReserveStatus(
    address _wrappedToken,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  )
    internal
    returns (
      ReserveStatus status,
      uint256 diff,
      uint256 reserveAmount
    )
  {
    uint256 wrappedBalance = WrappedPiErc20Interface(_wrappedToken).getWrappedBalance();

    uint256 reserveAmount = reserveRatioByWrapped[_wrappedToken].mul(_stakedBalance.add(wrappedBalance)).div(1 ether);
    reserveAmount = reserveAmount.add(_withdrawAmount);
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

  function _approveWrappedTokenToStacking(address _wrappedToken, uint256 _amount) internal {
    WrappedPiErc20Interface wrappedPi = WrappedPiErc20Interface(_wrappedToken);
    wrappedPi.approveToken(stackingByWrapped[_wrappedToken], _amount);
  }

  function _approveWrappedTokenToVoting(address _wrappedToken, uint256 _amount) internal {
    WrappedPiErc20Interface wrappedPi = WrappedPiErc20Interface(_wrappedToken);
    wrappedPi.approveToken(votingByWrapped[_wrappedToken], _amount);
  }
}
