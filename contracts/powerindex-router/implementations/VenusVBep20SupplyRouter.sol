// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../PowerIndexBasicRouter.sol";
import "../../interfaces/venus/VenusComptrollerInterface.sol";
import "../../interfaces/venus/VBep20Interface.sol";

contract VenusVBep20SupplyRouter is PowerIndexBasicRouter {
  event Stake(address indexed sender, uint256 amount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 rewardReceived);
  event IgnoreDueMissingStaking();
  event ClaimRewards(address indexed sender, uint256 xvsEarned, uint256 underlyingEarned);
  event DistributeUnderlyingReward(
    address indexed sender,
    uint256 underlyingReward,
    uint256 pvpReward,
    uint256 poolRewardsUnderlying,
    uint256 poolRewardsPi,
    address[] pools
  );

  struct VenusConfig {
    address troller;
    address xvs;
  }

  uint256 internal constant NO_ERROR_CODE = 0;

  address internal immutable TROLLER;
  IERC20 internal immutable UNDERLYING;
  IERC20 internal immutable XVS;

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    VenusConfig memory _compConfig
  ) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    TROLLER = _compConfig.troller;
    UNDERLYING = IERC20(VBep20Interface(_basicConfig.staking).underlying());
    XVS = IERC20(_compConfig.xvs);
  }

  /*** THE PROXIED METHOD EXECUTORS FOR VOTING ***/

  function _claimRewards(ReserveStatus) internal override {
    // #1. Claim XVS
    address[] memory holders = new address[](1);
    holders[0] = address(piToken);
    address[] memory tokens = new address[](1);
    tokens[0] = staking;

    uint256 xvsBefore = XVS.balanceOf(address(piToken));
    piToken.callExternal(
      TROLLER,
      VenusComptrollerInterface.claimVenus.selector,
      abi.encode(holders, tokens, false, true),
      0
    );
    uint256 xvsEarned = XVS.balanceOf(address(piToken)).sub(xvsBefore);
    if (xvsEarned > 0) {
      piToken.callExternal(address(XVS), IERC20.transfer.selector, abi.encode(address(this), xvsEarned), 0);
    }

    // #2. Redeem underlying interest
    uint256 pendingInterestReward = getPendingInterestReward();

    uint256 underlyingEarned = 0;
    if (pendingInterestReward > 0) {
      uint256 underlyingBefore = UNDERLYING.balanceOf(address(piToken));
      _callCompStaking(VBep20Interface(0).redeemUnderlying.selector, abi.encode(pendingInterestReward));
      underlyingEarned = UNDERLYING.balanceOf(address(piToken)).sub(underlyingBefore);
    }

    if (underlyingEarned > 0) {
      piToken.callExternal(
        address(UNDERLYING),
        IERC20.transfer.selector,
        abi.encode(address(this), underlyingEarned),
        0
      );
    }

    // #3. Emit claim results
    emit ClaimRewards(msg.sender, xvsEarned, underlyingEarned);
  }

  function _distributeRewards() internal override {
    uint256 xvsToDistribute = IERC20(XVS).balanceOf(address(this));
    uint256 underlyingToDistribute = UNDERLYING.balanceOf(address(this));
    require(xvsToDistribute > 0 || underlyingToDistribute > 0, "NOTHING_TO_DISTRIBUTE");

    if (XVS == UNDERLYING) {
      _distributeUnderlyingReward(underlyingToDistribute);
    } else {
      // WARNING: XVS distribution for the cases with XVS != UNDERLYING is not supported yet
      // The accrued XVS will remain on this contract
      _distributeUnderlyingReward(underlyingToDistribute);
    }
  }

  function _distributeUnderlyingReward(uint256 _underlyingToDistribute) internal {
    // Step #1. Distribute pvpReward
    (uint256 pvpReward, uint256 poolRewardsUnderlying) = _distributeRewardToPvp(_underlyingToDistribute, UNDERLYING);
    require(poolRewardsUnderlying > 0, "NO_POOL_REWARDS_UNDERLYING");

    // Step #2. Wrap underlying into piToken
    UNDERLYING.approve(address(piToken), poolRewardsUnderlying);
    piToken.deposit(poolRewardsUnderlying);

    // Step #3. Distribute piToken over the pools
    (uint256 poolRewardsPi, address[] memory pools) = _distributePiRemainderToPools(piToken);

    emit DistributeUnderlyingReward(
      msg.sender,
      _underlyingToDistribute,
      pvpReward,
      poolRewardsUnderlying,
      poolRewardsPi,
      pools
    );
  }

  /*** OWNER METHODS ***/

  function initRouter() external onlyOwner {
    address[] memory tokens = new address[](1);
    tokens[0] = staking;
    bytes memory result =
      piToken.callExternal(TROLLER, VenusComptrollerInterface.enterMarkets.selector, abi.encode(tokens), 0);
    uint256[] memory err = abi.decode(result, (uint256[]));
    require(err[0] == NO_ERROR_CODE, "V_ERROR");
    _callStaking(IERC20.approve.selector, abi.encode(staking, uint256(-1)));
  }

  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  function redeem(uint256 _amount) external onlyOwner {
    _redeem(_amount);
  }

  /*** POKE FUNCTION ***/

  function _beforePoke() internal override {
    super._beforePoke();
    require(VBep20Interface(staking).accrueInterest() == NO_ERROR_CODE, "V_ERROR");
  }

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 diff) internal override {
    if (reserveStatus == ReserveStatus.SHORTAGE) {
      _redeem(diff);
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  /*** VIEWERS ***/

  /**
   * @notice Get the amount of vToken will be minted in exchange of the given underlying tokens
   * @param _tokenAmount The input amount of underlying tokens
   * @return The corresponding amount of vTokens tokens
   */
  function getVTokenForToken(uint256 _tokenAmount) external view returns (uint256) {
    // token / exchangeRate
    return _tokenAmount.mul(1e18) / VBep20Interface(staking).exchangeRateStored();
  }

  /**
   * @notice Get the amount of underlying tokens will released in exchange of the given vTokens
   * @param _vTokenAmount The input amount of vTokens tokens
   * @return The corresponding amount of underlying tokens
   */
  function getTokenForVToken(uint256 _vTokenAmount) public view returns (uint256) {
    // vToken * exchangeRate
    return _vTokenAmount.mul(VBep20Interface(staking).exchangeRateStored()) / 1e18;
  }

  /**
   * @notice Get the total amount of UNDERLYING tokens could be released in exchange of the piToken's vToken balance.
   *         Is comprised of the underlyingStaked and the pendingRewards.
   * @return The UNDERLYING amount
   */
  function getUnderlyingBackedByVToken() public view returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }

    uint256 vTokenAtPiToken = IERC20(staking).balanceOf(address(piToken));
    if (vTokenAtPiToken == 0) {
      return 0;
    }

    return getTokenForVToken(vTokenAtPiToken);
  }

  /**
   * @notice Get the amount of current pending rewards available at VToken
   * @dev Does not includes the accrued XVS amount
   * @dev Uses the last cached value, not the current one
   * @dev Use with front-end only
   * @return amount of pending rewards
   */
  function getPendingInterestReward() public view returns (uint256 amount) {
    // return underlyingAtPiToken + underlyingBackedByVToken - piToken.totalSupply()
    amount = UNDERLYING.balanceOf(address(piToken)).add(getUnderlyingBackedByVToken()).add(1).sub(
      piToken.totalSupply()
    );
    return amount == 1 ? 0 : amount;
  }

  /*** EQUIVALENT METHODS OVERRIDES ***/

  function getPiEquivalentForUnderlying(
    uint256 _underlyingAmount,
    IERC20, /* _underlyingToken */
    uint256 /* _piTotalSupply */
  ) external view override returns (uint256) {
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
  ) external view override returns (uint256) {
    return _piAmount;
  }

  function getUnderlyingEquivalentForPiPure(
    uint256 _piAmount,
    uint256, /* _totalUnderlyingWrapped */
    uint256 /* _piTotalSupply */
  ) public pure override returns (uint256) {
    return _piAmount;
  }

  /*** INTERNALS ***/

  function _getUnderlyingStaked() internal view override returns (uint256) {
    // return piTokenTotalSupply - underlyingAtPiToken
    return piToken.totalSupply().sub(UNDERLYING.balanceOf(address(piToken)));
  }

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    uint256 underlyingBefore = UNDERLYING.balanceOf(address(piToken));

    piToken.approveUnderlying(staking, _amount);

    _callCompStaking(VBep20Interface(0).mint.selector, abi.encode(_amount));
    uint256 receivedReward = UNDERLYING.balanceOf(address(piToken)).sub(underlyingBefore.sub(_amount));
    piToken.callExternal(address(UNDERLYING), IERC20.transfer.selector, abi.encode(address(this), receivedReward), 0);

    emit Stake(msg.sender, _amount, receivedReward);
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_REDEEM_0");

    uint256 underlyingBefore = UNDERLYING.balanceOf(address(piToken));
    _callCompStaking(VBep20Interface(0).redeemUnderlying.selector, abi.encode(_amount));
    uint256 receivedReward = UNDERLYING.balanceOf(address(piToken)).sub(underlyingBefore).sub(_amount);
    piToken.callExternal(address(UNDERLYING), IERC20.transfer.selector, abi.encode(address(this), receivedReward), 0);

    emit Redeem(msg.sender, _amount, receivedReward);
  }

  function _callCompStaking(bytes4 _sig, bytes memory _data) internal {
    bytes memory result = _callStaking(_sig, _data);
    uint256 err = abi.decode(result, (uint256));
    require(err == NO_ERROR_CODE, "V_ERROR");
  }
}
