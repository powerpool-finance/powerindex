// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/IAlpacaFairLaunch.sol";
import "../PowerIndexBasicRouter.sol";
import "../../interfaces/IAlpacaVault.sol";

/**
 *
 */
contract AlpacaRouter is PowerIndexBasicRouter {
  uint256 internal immutable MASTER_CHEF_PID;

  event Stake(address indexed sender, uint256 amount, uint256 ibAlpacaAmount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 ibAlpacaAmount, uint256 rewardReceived);
  event IgnoreDueMissingStaking();
  event AutoClaimRewards(address indexed sender, uint256 alpacaRewards);
  event ClaimRewards(
    address indexed sender,
    uint256 calculatedAlpacaReward,
    uint256 calculatedIbAlpacaReward,
    uint256 actualAlpacaEarned
  );
  event DistributeRewards(
    address indexed sender,
    uint256 alpacaReward,
    uint256 pvpReward,
    uint256 poolRewardsUnderlying,
    uint256 poolRewardsPi,
    address[] pools
  );

  struct AlpacaConfig {
    address ibALPACA;
    address ALPACA;
    uint256 masterChefPid;
  }

  IERC20 internal immutable ALPACA;
  address internal immutable ibALPACA;

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    AlpacaConfig memory _alpacaConfig
  ) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    ALPACA = IERC20(_alpacaConfig.ALPACA);
    ibALPACA = _alpacaConfig.ibALPACA;
    MASTER_CHEF_PID = _alpacaConfig.masterChefPid;
  }

  /**
   * @notice Claims the rewards earned by providing liquidity to ibALPACA vault.
   * @dev Does NOT claim FairLaunch rewards.
   * @dev getPendingRewards returns the actual rewards since there was withdraw(0) call earlier
   *      which triggered interest accrual.
   */
  function _claimRewards(ReserveStatus) internal override {
    uint256 pendingInterestRewardAlpaca = getPendingRewards();
    uint256 pendingInterestRewardIbAlpaca = alpaca2IbAlpaca(pendingInterestRewardAlpaca);

    require(pendingInterestRewardAlpaca > 0, "NOTHING_TO_CLAIM_IB");

    // #1. Redeem ibALPACA diff. There is no reward distributed since it had been already distributed
    //     after stake/redeem action.
    _callStaking(
      IAlpacaFairLaunch.withdraw.selector,
      abi.encode(address(piToken), MASTER_CHEF_PID, pendingInterestRewardIbAlpaca)
    );

    // #2. Unwrap alpaca diff
    uint256 alpacaBefore = ALPACA.balanceOf(address(piToken));
    piToken.callExternal(ibALPACA, IAlpacaVault.withdraw.selector, abi.encode(pendingInterestRewardIbAlpaca), 0);
    uint256 alpacaEarned = ALPACA.balanceOf(address(piToken)).sub(alpacaBefore);

    require(alpacaEarned > 0, "NOTHING_EARNED");

    emit ClaimRewards(msg.sender, pendingInterestRewardAlpaca, pendingInterestRewardIbAlpaca, alpacaEarned);
  }

  function _distributeRewards() internal override {
    uint256 pendingReward = ALPACA.balanceOf(address(this));
    require(pendingReward > 0, "NO_PENDING_REWARD");

    // Step #1. Distribute pvpReward
    (uint256 pvpReward, uint256 poolRewardsUnderlying) = _distributeRewardToPvp(pendingReward, ALPACA);
    require(poolRewardsUnderlying > 0, "NO_POOL_REWARDS_UNDERLYING");

    // Step #2. Wrap ALPACA into piALPACA
    ALPACA.approve(address(piToken), poolRewardsUnderlying);
    piToken.deposit(poolRewardsUnderlying);

    // Step #3. Distribute piALPACA over the pools
    (uint256 poolRewardsPi, address[] memory pools) = _distributePiRemainderToPools(piToken);

    emit DistributeRewards(msg.sender, pendingReward, pvpReward, poolRewardsUnderlying, poolRewardsPi, pools);
  }

  /*** OWNER METHODS ***/

  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  function redeem(uint256 _amount) external onlyOwner {
    _redeem(_amount);
  }

  /*** POKE FUNCTION ***/

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 diff) internal override {
    require(staking != address(0), "STACKING_IS_NULL");

    if (reserveStatus == ReserveStatus.SHORTAGE) {
      _redeem(diff);
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  /*** VIEWERS ***/

  /**
   * @notice Returns the amount pending rewards earned by providing liquidity to ibALPACA vault.
   * @dev Does not includes the rewards minted by FairLaunch contract as they are distributed
   *      and moved to this router contact on each stake/redeem actions.
   * @return The amount of pending rewards available for claim in ALPACA
   */
  function getPendingRewards() public view returns (uint256) {
    // return alpacaAtPiToken + getUnderlyingStaked - piToken.totalSupply()
    return ALPACA.balanceOf(address(piToken)).add(_getUnderlyingStaked()).sub(piToken.totalSupply());
  }

  // WARNING: Unaccrued interest; Deposit will result in different rate
  function alpaca2IbAlpaca(uint256 _alpacaAmount) public view returns (uint256) {
    uint256 totalToken = IAlpacaVault(ibALPACA).totalToken();
    return totalToken == 0 ? _alpacaAmount : _alpacaAmount.mul(IERC20(ibALPACA).totalSupply()).div(totalToken);
  }

  function ibAlpaca2Alpaca(uint256 _ibAlpacaAmount) public view returns (uint256) {
    uint256 totalToken = IAlpacaVault(ibALPACA).totalToken();
    return _ibAlpacaAmount.mul(totalToken).div(IERC20(ibALPACA).totalSupply());
  }

  /*** INTERNALS ***/

  function _getUnderlyingStaked() internal view override returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }
    (uint256 ibAlpacaStaked, ) = IAlpacaFairLaunch(staking).userInfo(MASTER_CHEF_PID, address(piToken));
    return ibAlpaca2Alpaca(ibAlpacaStaked);
  }

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    // Step #1. Mint ibALPACA
    uint256 ibAlpacaBefore = IERC20(ibALPACA).balanceOf(address(piToken));
    piToken.approveUnderlying(ibALPACA, _amount);
    piToken.callExternal(ibALPACA, IAlpacaVault.deposit.selector, abi.encode(_amount), 0);
    uint256 ibAlpacaWrapped = IERC20(ibALPACA).balanceOf(address(piToken)).sub(ibAlpacaBefore);

    require(ibAlpacaWrapped > 0, "CANT_STAKE_0_IB");

    uint256 alpacaBefore = ALPACA.balanceOf(address(piToken));

    // Step #2. Stake ibALPACA
    piToken.callExternal(ibALPACA, IERC20.approve.selector, abi.encode(staking, ibAlpacaWrapped), 0);
    _callStaking(IAlpacaFairLaunch.deposit.selector, abi.encode(piToken, MASTER_CHEF_PID, ibAlpacaWrapped));

    uint256 receivedReward = ALPACA.balanceOf(address(piToken)).sub(alpacaBefore);
    _safeTransfer(ALPACA, address(this), receivedReward);

    emit AutoClaimRewards(msg.sender, receivedReward);
    emit Stake(msg.sender, _amount, ibAlpacaWrapped, receivedReward);
  }

  function _redeem(uint256 _alpacaAmount) internal {
    require(_alpacaAmount > 0, "CANT_REDEEM_0");

    // Accrue interest
    IAlpacaVault(ibALPACA).withdraw(0);

    uint256 ibAlpacaAmount = alpaca2IbAlpaca(_alpacaAmount);
    require(_alpacaAmount > 0, "CANT_REDEEM_0_IB");

    uint256 alpacaBefore = ALPACA.balanceOf(address(piToken));
    _callStaking(IAlpacaFairLaunch.withdraw.selector, abi.encode(address(piToken), MASTER_CHEF_PID, ibAlpacaAmount));
    uint256 receivedReward = ALPACA.balanceOf(address(piToken)).sub(alpacaBefore);
    _safeTransfer(ALPACA, address(this), receivedReward);

    piToken.callExternal(ibALPACA, IAlpacaVault.withdraw.selector, abi.encode(ibAlpacaAmount), 0);

    emit AutoClaimRewards(msg.sender, receivedReward);
    emit Redeem(msg.sender, _alpacaAmount, ibAlpacaAmount, receivedReward);
  }
}
