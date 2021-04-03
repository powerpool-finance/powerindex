// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/sushi/ISushiBar.sol";
import "../PowerIndexBasicRouter.sol";

contract SushiPowerIndexRouter is PowerIndexBasicRouter {
  event Stake(address indexed sender, uint256 amount);
  event Redeem(address indexed sender, uint256 amount);
  event IgnoreDueMissingStaking();
  event ClaimRewards(
    address indexed sender,
    uint256 xSushiBurned,
    uint256 expectedSushiReward,
    uint256 releasedSushiReward
  );
  event DistributeRewards(
    address indexed sender,
    uint256 sushiReward,
    uint256 pvpReward,
    uint256 poolRewardsUnderlying,
    uint256 poolRewardsPi,
    address[] pools
  );

  struct SushiConfig {
    address SUSHI;
  }

  IERC20 internal immutable SUSHI;

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    SushiConfig memory _sushiConfig
  ) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    SUSHI = IERC20(_sushiConfig.SUSHI);
  }

  /*** PERMISSIONLESS REWARD CLAIMING AND DISTRIBUTION ***/

  /**
   * @notice Withdraws the extra staked SUSHI as a reward and transfers it to the router
   */
  function _claimRewards() internal override {
    uint256 rewardsPending = getPendingRewards();
    require(rewardsPending > 0, "NOTHING_TO_CLAIM");

    uint256 sushiBefore = SUSHI.balanceOf(address(piToken));
    uint256 xSushiToBurn = getXSushiForSushi(rewardsPending);

    // Step #1. Claim the excess of SUSHI from SushiBar
    _callStaking(ISushiBar.leave.selector, abi.encode(xSushiToBurn));
    uint256 released = SUSHI.balanceOf(address(piToken)).sub(sushiBefore);
    require(released > 0, "NOTHING_RELEASED");

    // Step #2. Transfer the claimed SUSHI to the router
    piToken.callExternal(address(SUSHI), SUSHI.transfer.selector, abi.encode(address(this), released), 0);

    emit ClaimRewards(msg.sender, xSushiToBurn, rewardsPending, released);
  }

  /**
   * @notice Wraps the router's SUSHIs into piTokens and transfers it to the pools proportionally their SUSHI balances
   */
  function _distributeRewards() internal override {
    uint256 pendingReward = SUSHI.balanceOf(address(this));
    require(pendingReward > 0, "NO_PENDING_REWARD");

    // Step #1. Distribute pvpReward
    (uint256 pvpReward, uint256 poolRewardsUnderlying) = _distributeRewardToPvp(pendingReward, SUSHI);
    require(poolRewardsUnderlying > 0, "NO_POOL_REWARDS_UNDERLYING");

    // Step #2. Wrap SUSHI into piSUSHI
    SUSHI.approve(address(piToken), poolRewardsUnderlying);
    piToken.deposit(poolRewardsUnderlying);

    // Step #3. Distribute piSUSHI over the pools
    (uint256 poolRewardsPi, address[] memory pools) = _distributePiRemainderToPools(piToken);

    emit DistributeRewards(msg.sender, pendingReward, pvpReward, poolRewardsUnderlying, poolRewardsPi, pools);
  }

  /*** VIEWERS ***/

  /**
   * @notice Get the amount of xSUSHI tokens SushiBar will mint in exchange of the given SUSHI tokens
   * @param _sushi The input amount of SUSHI tokens
   * @return The corresponding amount of xSUSHI tokens
   */
  function getXSushiForSushi(uint256 _sushi) public view returns (uint256) {
    return _sushi.mul(IERC20(staking).totalSupply()) / SUSHI.balanceOf(staking);
  }

  /**
   * @notice Get the amount of SUSHI tokens SushiBar will release in exchange of the given xSUSHI tokens
   * @param _xSushi The input amount of xSUSHI tokens
   * @return The corresponding amount of SUSHI tokens
   */
  function getSushiForXSushi(uint256 _xSushi) external view returns (uint256) {
    return _xSushi.mul(SUSHI.balanceOf(staking)) / IERC20(staking).totalSupply();
  }

  /**
   * @notice Get the total amount of SUSHI tokens could be released in exchange of the piToken's xSUSHI balance.
   *         Is comprised of the underlyingStaked and the pendingRewards.
   * @return The SUSHI amount
   */
  function getUnderlyingBackedByXSushi() public view returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }

    uint256 xSushiAtPiToken = IERC20(staking).balanceOf(address(piToken));
    if (xSushiAtPiToken == 0) {
      return 0;
    }

    uint256 sushiAtBar = SUSHI.balanceOf(staking);
    uint256 xSushiTotal = IERC20(staking).totalSupply();

    // return xSushiAtPiToken * sushiAtBar / xSushiTotal;
    return xSushiAtPiToken.mul(sushiAtBar) / xSushiTotal;
  }

  /**
   * @notice Get the amount of current pending rewards available at SushiBar
   * @return The amount of pending rewards
   */
  function getPendingRewards() public view returns (uint256) {
    // return sushiAtPiToken + sushiBackedByXSushi - piToken.totalSupply()
    return SUSHI.balanceOf(address(piToken)).add(getUnderlyingBackedByXSushi()).sub(piToken.totalSupply().sub(100));
  }

  /*** EQUIVALENT METHODS OVERRIDES ***/

  function getPiEquivalentForUnderlying(
    uint256 _underlyingAmount,
    IERC20, /* _underlyingToken */
    uint256 /* _piTotalSupply */
  ) public view override returns (uint256) {
    return _underlyingAmount;
  }

  function getPiEquivalentForUnderlyingPure(
    uint256 _underlyingAmount,
    uint256, /* _totalUnderlyingWrapped */
    uint256 /* _piTotalSupply */
  ) public pure override returns (uint256) {
    return _underlyingAmount;
  }

  function getUnderlyingEquivalentForPi(
    uint256 _piAmount,
    IERC20, /* _underlyingToken */
    uint256 /* _piTotalSupply */
  ) public view override returns (uint256) {
    return _piAmount;
  }

  function getUnderlyingEquivalentForPiPure(
    uint256 _piAmount,
    uint256, /* _totalUnderlyingWrapped */
    uint256 /* _piTotalSupply */
  ) public pure override returns (uint256) {
    return _piAmount;
  }

  /*** OWNER METHODS ***/

  /**
   * @notice The contract owner manually stakes the given amount of SUSHI
   * @param _sushi The amount SUSHI to stake
   */
  function stake(uint256 _sushi) external onlyOwner {
    _stake(_sushi);
  }

  /**
   * @notice The contract owner manually burns the given amount of xSUSHI in exchange of SUSHI tokens
   * @param _xSushi The amount xSUSHI to burn
   */
  function redeem(uint256 _xSushi) external onlyOwner {
    _redeem(_xSushi);
  }

  /*** POKE FUNCTION ***/

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 sushiDiff) internal override {
    require(staking != address(0), "STACKING_IS_NULL");

    if (reserveStatus == ReserveStatus.SHORTAGE) {
      _redeem(getXSushiForSushi(sushiDiff));
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(sushiDiff);
    }
  }

  /*** INTERNALS ***/

  /**
   * @notice Get the opposite to the reserve ratio amount of SUSHI staked at SushiBar
   * @return The SUSHI amount
   */
  function _getUnderlyingStaked() internal view override returns (uint256) {
    // return piTokenTotalSupply - sushiAtPiToken
    return piToken.totalSupply().sub(SUSHI.balanceOf(address(piToken)));
  }

  function _stake(uint256 _sushi) internal {
    require(_sushi > 0, "CANT_STAKE_0");

    piToken.approveUnderlying(staking, _sushi);
    _callStaking(ISushiBar(0).enter.selector, abi.encode(_sushi));

    emit Stake(msg.sender, _sushi);
  }

  function _redeem(uint256 _xSushi) internal {
    require(_xSushi > 0, "CANT_REDEEM_0");

    _callStaking(ISushiBar(0).leave.selector, abi.encode(_xSushi));

    emit Redeem(msg.sender, _xSushi);
  }
}
