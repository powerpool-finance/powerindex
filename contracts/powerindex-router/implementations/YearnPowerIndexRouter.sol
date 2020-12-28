// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/WrappedPiErc20Interface.sol";
import "../../interfaces/YearnGovernanceInterface.sol";
import "../../interfaces/IYDeposit.sol";
import "../../interfaces/BPoolInterface.sol";
import "../../interfaces/IUniswapV2Router02.sol";
import "./../PowerIndexBasicRouter.sol";

contract YearnPowerIndexRouter is PowerIndexBasicRouter {
  event SetRewardPools(uint256 len, address[] rewardPools);
  event SetPvpFee(uint256 pvpFee);
  event SetUniswapRouter(address uniswapRouter);
  event SetUsdcYfiSwapPath(address[] usdcYfiSwapPath);
  event Stake(uint256 amount);
  event Redeem(uint256 amount);
  event IgnoreRedeemDueVoteLock(uint256 voteLockUntilBlock);
  event ClaimRewards(
    address indexed caller,
    uint256 yCrvReward,
    uint256 usdcConverted,
    uint256 yfiConverted,
    uint256 yfiGain,
    uint256 pvpReward,
    uint256 poolRewards,
    uint256 piYfiBalance,
    address[] uniswapSwapPath,
    address[] pools
  );
  event RewardPool(address indexed pool, uint256 amount);
  event IgnoreDueMissingVoting();

  struct YearnConfig {
    address YCRV;
    address USDC;
    address YFI;
    address payable uniswapRouter;
    address curveYDeposit;
    address pvp;
    uint256 pvpFee;
    address[] rewardPools;
    address[] usdcYfiSwapPath;
  }

  int128 internal constant USDC_CURVE_Y_INDEX = 1;

  address public immutable curveYDeposit;
  address public immutable pvp;
  IERC20 public immutable YCRV;
  IERC20 public immutable USDC;
  IERC20 public immutable YFI;

  address payable public uniswapRouter;
  // 1 ether == 100%
  uint256 public pvpFee;
  address[] public rewardPools;
  address[] public usdcYfiSwapPath;

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    YearnConfig memory _yearnConfig
  ) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    require(_yearnConfig.pvpFee < HUNDRED_PCT, "PVP_FEE_OVER_THE_LIMIT");
    require(_yearnConfig.curveYDeposit != address(0), "INVALID_YDEPOSIT_ADDR");
    require(_yearnConfig.pvp != address(0), "INVALID_PVP_ADDR");
    require(_yearnConfig.YCRV != address(0), "INVALID_YCRV_ADDR");
    require(_yearnConfig.USDC != address(0), "INVALID_USDC_ADDR");
    require(_yearnConfig.YFI != address(0), "INVALID_YFI_ADDR");

    YCRV = IERC20(_yearnConfig.YCRV);
    USDC = IERC20(_yearnConfig.USDC);
    YFI = IERC20(_yearnConfig.YFI);
    uniswapRouter = _yearnConfig.uniswapRouter;
    curveYDeposit = _yearnConfig.curveYDeposit;
    pvp = _yearnConfig.pvp;
    pvpFee = _yearnConfig.pvpFee;
    rewardPools = _yearnConfig.rewardPools;
    usdcYfiSwapPath = _yearnConfig.usdcYfiSwapPath;
  }

  /*** PERMISSIONLESS METHODS ***/

  function claimRewards() external {
    uint256 poolsLen = rewardPools.length;
    require(poolsLen > 0, "MISSING_REWARD_POOLS");
    require(usdcYfiSwapPath.length > 0, "MISSING_REWARD_SWAP_PATH");

    uint256 yfiBalanceBefore = YFI.balanceOf(address(this));

    // Step #1. Claim yCrv reward from YFI governance pool
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).getReward.selector, "");

    uint256 yCrvReward = YCRV.balanceOf(address(piToken));
    require(yCrvReward > 0, "NO_YCRV_REWARD");

    // Step #2. Transfer yCrv reward to the router
    piToken.callExternal(address(YCRV), YCRV.transfer.selector, abi.encode(address(this), yCrvReward), 0);

    // Step #3. Unwrap yCrv -> USDC @ yDeposit
    YCRV.approve(curveYDeposit, yCrvReward);
    IYDeposit(curveYDeposit).remove_liquidity_one_coin(yCrvReward, USDC_CURVE_Y_INDEX, 1000, true);

    uint256 usdcConverted = USDC.balanceOf(address(this));
    require(usdcConverted > 0, "NO_USDC_REWARD");

    // Step #4. Swap USDC -> ETH -> YFI @ Uniswap
    USDC.approve(uniswapRouter, usdcConverted);
    IUniswapV2Router02(uniswapRouter).swapExactTokensForTokens(
      usdcConverted,
      0,
      usdcYfiSwapPath,
      address(this),
      block.timestamp
    );

    uint256 yfiConverted = YFI.balanceOf(address(this));
    require(yfiConverted > 0, "NO_YFI_REWARD");

    uint256 yfiGain = yfiConverted.sub(yfiBalanceBefore);
    require(yfiGain > 0, "NO_YFI_GAIN");

    // Step #5. Calculate pvpReward
    uint256 pvpReward = 0;
    if (pvpFee > 0) {
      pvpReward = yfiGain.mul(pvpFee).div(HUNDRED_PCT);
      YFI.transfer(pvp, pvpReward);
    }

    uint256 poolRewards = yfiGain.sub(pvpReward);
    require(poolRewards > 0, "NO_POOL_REWARDS");

    // Step #6. Wrap gained yfi into piYfi
    YFI.approve(address(piToken), poolRewards);
    piToken.deposit(poolRewards);

    uint256 piYfiBalance = piToken.balanceOf(address(this));
    require(piYfiBalance > 0, "NO_PI_YFI");

    // Step #8. Distribute yfi leftovers over the pool
    uint256 totalPiYfiOnPools = 0;
    for (uint256 i = 0; i < poolsLen; i++) {
      totalPiYfiOnPools = totalPiYfiOnPools.add(piToken.balanceOf(rewardPools[i]));
    }
    require(totalPiYfiOnPools > 0, "TOTAL_PIYFI_IS_0");

    for (uint256 i = 0; i < poolsLen; i++) {
      address pool = rewardPools[i];
      uint256 poolPiYfiBalance = piToken.balanceOf(pool);
      if (poolPiYfiBalance == 0) {
        continue;
      }

      uint256 poolReward = piYfiBalance.mul(poolPiYfiBalance) / totalPiYfiOnPools;

      piToken.transfer(pool, poolReward);

      BPoolInterface(pool).gulp(address(piToken));
      emit RewardPool(pool, poolReward);
    }

    emit ClaimRewards(
      msg.sender,
      yCrvReward,
      usdcConverted,
      yfiConverted,
      yfiGain,
      pvpReward,
      poolRewards,
      piYfiBalance,
      usdcYfiSwapPath,
      rewardPools
    );

    // NOTICE: it's ok to keep some YFI dust here for the future swaps
  }

  /*** OWNER METHODS ***/

  function setRewardPools(address[] calldata _rewardPools) external onlyOwner {
    require(_rewardPools.length > 0, "AT_LEAST_ONE_EXPECTED");
    rewardPools = _rewardPools;
    emit SetRewardPools(_rewardPools.length, _rewardPools);
  }

  function setPvpFee(uint256 _pvpFee) external onlyOwner {
    require(_pvpFee < HUNDRED_PCT, "PVP_FEE_OVER_THE_LIMIT");
    pvpFee = _pvpFee;
    emit SetPvpFee(_pvpFee);
  }

  function setUniswapRouter(address payable _unsiwapRouter) external onlyOwner {
    uniswapRouter = _unsiwapRouter;
    emit SetUniswapRouter(_unsiwapRouter);
  }

  function setUsdcYfiSwapPath(address[] calldata _usdcYfiSwapPath) external onlyOwner {
    usdcYfiSwapPath = _usdcYfiSwapPath;
    emit SetUsdcYfiSwapPath(_usdcYfiSwapPath);
  }

  /*** THE PROXIED METHOD EXECUTORS ***/

  function callRegister() external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).register.selector, "");
  }

  function callExit() external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).exit.selector, "");
  }

  function callPropose(address _executor, string calldata _hash) external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).propose.selector, abi.encode(_executor, _hash));
  }

  function callVoteFor(uint256 _id) external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).voteFor.selector, abi.encode(_id));
  }

  function callVoteAgainst(uint256 _id) external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).voteAgainst.selector, abi.encode(_id));
  }

  /*** OWNER METHODS ***/

  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  function redeem(uint256 _amount) external onlyOwner {
    _redeem(_amount);
  }

  /*** PI TOKEN CALLBACK ***/

  function piTokenCallback(uint256 _withdrawAmount) external override {
    address piToken_ = msg.sender;

    // Ignore the tokens without a voting assigned
    if (voting == address(0)) {
      emit IgnoreDueMissingVoting();
      return;
    }

    if (!_rebalanceHook()) {
      return;
    }

    YearnGovernanceInterface _voting = YearnGovernanceInterface(voting);
    (ReserveStatus status, uint256 diff, ) = _getReserveStatus(_voting.balanceOf(piToken_), _withdrawAmount);

    if (status == ReserveStatus.SHORTAGE) {
      uint256 voteLockUntilBlock = _voting.voteLock(piToken_);
      if (voteLockUntilBlock < block.number) {
        _redeem(diff);
      } else {
        emit IgnoreRedeemDueVoteLock(voteLockUntilBlock);
      }
    } else if (status == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  /*** INTERNALS ***/

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    piToken.approveUnderlying(voting, _amount);
    _callVoting(YearnGovernanceInterface(0).stake.selector, abi.encode(_amount));

    emit Stake(_amount);
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_WITHDRAW_0");

    _callVoting(YearnGovernanceInterface(0).withdraw.selector, abi.encode(_amount));

    emit Redeem(_amount);
  }
}
