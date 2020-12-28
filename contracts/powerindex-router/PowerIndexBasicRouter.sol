// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/IPoolRestrictions.sol";
import "../interfaces/PowerIndexBasicRouterInterface.sol";
import "./PowerIndexNaiveRouter.sol";

contract PowerIndexBasicRouter is PowerIndexBasicRouterInterface, PowerIndexNaiveRouter {
  uint256 public constant HUNDRED_PCT = 1 ether;

  event SetVotingAndStaking(address indexed voting, address indexed staking);
  event SetReserveRatio(uint256 ratio, uint256 rebalancingInterval);
  event SetRebalancingInterval(uint256 rebalancingInterval);
  event IgnoreRebalancing(uint256 blockTimestamp, uint256 lastRebalancedAt, uint256 rebalancingInterval);

  enum ReserveStatus { EQUILIBRIUM, SHORTAGE, EXCESS }

  struct BasicConfig {
    address poolRestrictions;
    address voting;
    address staking;
    uint256 reserveRatio;
    uint256 rebalancingInterval;
  }

  WrappedPiErc20Interface public immutable piToken;

  IPoolRestrictions public poolRestriction;
  address public voting;
  address public staking;
  uint256 public reserveRatio;
  uint256 public rebalancingInterval;
  uint256 public lastRebalancedAt;

  constructor(address _piToken, BasicConfig memory _basicConfig) public PowerIndexNaiveRouter() Ownable() {
    piToken = WrappedPiErc20Interface(_piToken);
    poolRestriction = IPoolRestrictions(_basicConfig.poolRestrictions);
    voting = _basicConfig.voting;
    staking = _basicConfig.staking;
    reserveRatio = _basicConfig.reserveRatio;
    rebalancingInterval = _basicConfig.rebalancingInterval;
  }

  function setVotingAndStaking(address _voting, address _staking) external override onlyOwner {
    voting = _voting;
    staking = _staking;
    emit SetVotingAndStaking(_voting, _staking);
  }

  function setReserveConfig(uint256 _reserveRatio, uint256 _rebalancingInterval) external override onlyOwner {
    require(_reserveRatio <= HUNDRED_PCT, "RR_GREATER_THAN_100_PCT");
    reserveRatio = _reserveRatio;
    rebalancingInterval = _rebalancingInterval;
    emit SetReserveRatio(_reserveRatio, _rebalancingInterval);
  }

  function _callVoting(bytes4 _sig, bytes memory _data) internal {
    piToken.callExternal(voting, _sig, _data, 0);
  }

  function _callStaking(bytes4 _sig, bytes memory _data) internal {
    piToken.callExternal(staking, _sig, _data, 0);
  }

  function _checkVotingSenderAllowed() internal view {
    require(poolRestriction.isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
  }

  function _rebalanceHook() internal returns (bool) {
    uint256 blockTimestamp_ = block.timestamp;
    uint256 lastRebalancedAt_ = lastRebalancedAt;
    uint256 rebalancingInterval_ = rebalancingInterval;

    if (blockTimestamp_ <= lastRebalancedAt_.add(rebalancingInterval)) {
      emit IgnoreRebalancing(blockTimestamp_, lastRebalancedAt_, rebalancingInterval_);
      return false;
    }

    lastRebalancedAt = blockTimestamp_;
    return true;
  }

  /*
   * * In case of deposit, the deposited amount is already accounted on the pi token contract right away, no further
   *   adjustment required.
   * * In case of withdrawal, the withdrawAmount is deducted from the sum of pi token and staked balances
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
    return getReserveStatusPure(reserveRatio, piToken.getUnderlyingBalance(), _stakedBalance, _withdrawAmount);
  }

  function getPiEquivalentForUnderlying(
    uint256 _underlyingAmount,
    IERC20 _underlyingToken,
    uint256 _underlyingOnPiToken,
    uint256 _piTotalSupply
  ) external view override returns (uint256) {
    return
      getPiEquivalentForUnderlyingPure(
        _underlyingAmount,
        // _underlyingOnPiToken + _underlyingToken.balanceOf(staking),
        _underlyingOnPiToken.add(_underlyingToken.balanceOf(staking)),
        _piTotalSupply
      );
  }

  function getPiEquivalentForUnderlyingPure(
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
   * @param _leftOnPiToken The amount of origin tokens left on the piToken (WrappedPiErc20) contract
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
    uint256 _leftOnPiToken,
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
    expectedReserveAmount = getExpectedReserveAmount(_reserveRatioPct, _leftOnPiToken, _stakedBalance, _withdrawAmount);

    if (expectedReserveAmount > _leftOnPiToken) {
      status = ReserveStatus.SHORTAGE;
      diff = expectedReserveAmount.sub(_leftOnPiToken);
    } else if (expectedReserveAmount < _leftOnPiToken) {
      status = ReserveStatus.EXCESS;
      diff = _leftOnPiToken.sub(expectedReserveAmount);
    } else {
      status = ReserveStatus.EQUILIBRIUM;
      diff = 0;
    }
  }

  /**
   * @notice Calculates an expected reserve amount after the transaction taking into an account the withdrawAmount
   * @param _reserveRatioPct % of a reserve ratio, 1 ether == 100%
   * @param _leftOnPiToken The amount of origin tokens left on the piToken (WrappedPiErc20) contract
   * @param _stakedBalance The amount of original tokens staked on the staking contract
   * @param _withdrawAmount The amount to be withdrawn within the current transaction
   *                        (could be negative in a case of deposit)
   * @return expectedReserveAmount The expected reserve amount
   *
   *                           / %reserveRatio * (staked + _leftOnPiToken - withdrawAmount) \
   * expectedReserveAmount =  | ------------------------------------------------------------| + withdrawAmount
   *                           \                         100%                              /
   */
  function getExpectedReserveAmount(
    uint256 _reserveRatioPct,
    uint256 _leftOnPiToken,
    uint256 _stakedBalance,
    uint256 _withdrawAmount
  ) public pure returns (uint256) {
    return
      _reserveRatioPct.mul(_stakedBalance.add(_leftOnPiToken).sub(_withdrawAmount)).div(HUNDRED_PCT).add(
        _withdrawAmount
      );
  }
}
