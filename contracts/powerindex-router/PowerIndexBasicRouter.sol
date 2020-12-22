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

  enum ReserveStatus { EQUAL, ABOVE, BELOW }

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
      uint256 adjustedReserveAmount
    )
  {
    return getReserveStatusPure(reserveRatio, wrappedToken.getWrappedBalance(), _stakedBalance, _withdrawAmount);
  }

  /**
   *
   * Reserve status has the following options:
   * * ABOVE - there is not enough underlying funds on the wrapper contract to satisfy the reserve ratio,
   *           the diff amount should be redeemed from the staking contract
   * * BELOW - there are some extra funds over reserve ratio on the wrapper contract,
   *           the diff amount should be sent to the staking contract
   */
  function getReserveStatusPure(
    uint256 _reserveRatio,
    uint256 _leftOnWrapper,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  )
    public
    pure
    returns (
      ReserveStatus status,
      uint256 diff,
      uint256 adjustedReserveAmount
    )
  {
    adjustedReserveAmount = calculateAdjustedReserveAmount(_reserveRatio, _leftOnWrapper, _stakedBalance, _withdrawAmount);

    if (adjustedReserveAmount > _leftOnWrapper) {
      status = ReserveStatus.ABOVE;
      diff = adjustedReserveAmount.sub(_leftOnWrapper);
    } else if (adjustedReserveAmount < _leftOnWrapper) {
      status = ReserveStatus.BELOW;
      diff = _leftOnWrapper.sub(adjustedReserveAmount);
    } else {
      status = ReserveStatus.EQUAL;
      diff = 0;
    }
  }

  /**
   * @notice Calculates a reserve amount taking into an account the withdrawAmount
   * @param _reserveRatioPct % of a reserve ratio, 1 ether == 100%
   * @param _leftOnWrapper The amount of origin tokens left on the token-wrapper (WrappedPiErc20) contract
   * @param _stakedBalance The amount of original tokens staked on the staking contract
   * @param _withdrawAmount The amount to be withdrawn within the current transaction
   *                        (could be negative in a case of deposit)
   * @return adjustedReserveAmount The amount of origin ERC20 tokens
   *
   *                           / %reserveRatio * (staked + leftOnWrapper) \
   * adjustedReserveAmount =  | -------------------------------------------| + withdrawAmount
   *                           \                  100%                    /
   */
  function calculateAdjustedReserveAmount(
    uint256 _reserveRatioPct,
    uint256 _leftOnWrapper,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  ) public pure returns (uint256) {
    return _reserveRatioPct
        .mul(_stakedBalance.add(_leftOnWrapper))
        .div(HUNDRED_PCT)
        .add(_withdrawAmount);
  }
}
