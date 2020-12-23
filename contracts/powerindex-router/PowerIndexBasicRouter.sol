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

  enum ReserveStatus { EQUILIBRIUM, SHORTAGE, EXCESS }

  WrappedPiErc20Interface public immutable wrappedToken;

  IPoolRestrictions public poolRestriction;
  address public voting;
  address public staking;
  uint256 public reserveRatio;

  constructor(address _piToken, address _poolRestrictions) public PowerIndexNaiveRouter() Ownable() {
    wrappedToken = WrappedPiErc20Interface(_piToken);
    poolRestriction = IPoolRestrictions(_poolRestrictions);
  }

  function setVotingAndStaking(address _voting, address _staking) external override onlyOwner {
    voting = _voting;
    staking = _staking;
    emit SetVotingAndStaking(_voting, _staking);
  }

  function setReserveRatio(uint256 _reserveRatio) external override onlyOwner {
    require(_reserveRatio <= HUNDRED_PCT, "RR_GREATER_THAN_100_PCT");
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

  /*
   * * In case of deposit, the deposited amount is already accounted on the wrapper contract right away, no further
   *   adjustment required.
   * * In case of withdrawal, the withdrawAmount is deducted from the sum of wrapper and staked balances
   *
   */
  function _getReserveStatus(uint256 _stakedBalance, uint256 _withdrawAmount)
    internal
    view
    returns (
      ReserveStatus status,
      uint256 diff,
      uint256 adjustedReserveAmount
    )
  {
    return getReserveStatusPure(reserveRatio, wrappedToken.getUnderlyingBalance(), _stakedBalance, _withdrawAmount);
  }

  function getPiEquivalentFroUnderlying(
    uint256 _underlyingAmount,
    IERC20 _underlyingToken,
    uint256 _underlyingOnWrapper,
    uint256 _piTotalSupply
  ) external view override returns (uint256) {
    return
      getPiEquivalentFroUnderlyingPure(
        _underlyingAmount,
        // _underlyingOnWrapper + _underlyingToken.balanceOf(staking),
        _underlyingOnWrapper.add(_underlyingToken.balanceOf(staking)),
        _piTotalSupply
      );
  }

  function getPiEquivalentFroUnderlyingPure(
    uint256 _underlyingAmount,
    uint256 _totalUnderlyingWrapped,
    uint256 _piTotalSupply
  ) public pure override returns (uint256) {
    if (_totalUnderlyingWrapped == 0) {
      return _underlyingAmount;
    }
    // return _piTotalSupply * _underlyingAmount / _totalUnderlyingWrapped;
    return _piTotalSupply.mul(_underlyingAmount).div(_totalUnderlyingWrapped);
  }

  /**
   * @notice Calculates the desired reserve status
   * @param _reserveRatioPct The reserve ratio in %, 1 ether == 100 ether
   * @param _leftOnWrapper The amount of origin tokens left on the token-wrapper (WrappedPiErc20) contract
   * @param _stakedBalance The amount of original tokens staked on the staking contract
   * @param _withdrawAmount The amount to be withdrawn within the current transaction
   *                        (could be negative in a case of deposit)
   * @return status The reserve status:
   * * SHORTAGE - There is not enough underlying funds on the wrapper contract to satisfy the reserve ratio,
   *           the diff amount should be redeemed from the staking contract
   * * EXCESS - there are some extra funds over reserve ratio on the wrapper contract,
   *           the diff amount should be sent to the staking contract
   * * EQUILIBRIUM - the reserve ratio hasn't changed,
   *           the diff amount is 0 and there are no additional stake/redeem actions expected
   * @return diff The difference between `adjustedReserveAmount` and `_leftOnWrapper`
   * @return expectedReserveAmount The calculated expected reserve amount
   */
  function getReserveStatusPure(
    uint256 _reserveRatioPct,
    uint256 _leftOnWrapper,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  )
    public
    pure
    returns (
      ReserveStatus status,
      uint256 diff,
      uint256 expectedReserveAmount
    )
  {
    require(_reserveRatioPct <= HUNDRED_PCT, "RR_GREATER_THAN_100_PCT");
    expectedReserveAmount = getExpectedReserveAmount(_reserveRatioPct, _leftOnWrapper, _stakedBalance, _withdrawAmount);

    if (expectedReserveAmount > _leftOnWrapper) {
      status = ReserveStatus.SHORTAGE;
      diff = expectedReserveAmount.sub(_leftOnWrapper);
    } else if (expectedReserveAmount < _leftOnWrapper) {
      status = ReserveStatus.EXCESS;
      diff = _leftOnWrapper.sub(expectedReserveAmount);
    } else {
      status = ReserveStatus.EQUILIBRIUM;
      diff = 0;
    }
  }

  /**
   * @notice Calculates an expected reserve amount after the transaction taking into an account the withdrawAmount
   * @param _reserveRatioPct % of a reserve ratio, 1 ether == 100%
   * @param _leftOnWrapper The amount of origin tokens left on the token-wrapper (WrappedPiErc20) contract
   * @param _stakedBalance The amount of original tokens staked on the staking contract
   * @param _withdrawAmount The amount to be withdrawn within the current transaction
   *                        (could be negative in a case of deposit)
   * @return expectedReserveAmount The expected reserve amount
   *
   *                           / %reserveRatio * (staked + leftOnWrapper - withdrawAmount) \
   * expectedReserveAmount =  | ------------------------------------------------------------| + withdrawAmount
   *                           \                         100%                              /
   */
  function getExpectedReserveAmount(
    uint256 _reserveRatioPct,
    uint256 _leftOnWrapper,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  ) public pure returns (uint256) {
    return
      _reserveRatioPct.mul(_stakedBalance.add(_leftOnWrapper).sub(_withdrawAmount)).div(HUNDRED_PCT).add(
        _withdrawAmount
      );
  }
}
