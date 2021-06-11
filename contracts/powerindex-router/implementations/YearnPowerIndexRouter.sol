// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/YearnGovernanceInterface.sol";
import "../../interfaces/IYDeposit.sol";
import "../../interfaces/IUniswapV2Router02.sol";
import "./../PowerIndexBasicRouter.sol";

contract YearnPowerIndexRouter is PowerIndexBasicRouter {
  event SetUniswapRouter(address uniswapRouter);
  event SetUsdcYfiSwapPath(address[] usdcYfiSwapPath);
  event Stake(address indexed sender, uint256 amount);
  event Redeem(address indexed sender, uint256 amount);
  event IgnoreRedeemDueVoteLock(uint256 voteLockUntilBlock);
  event DistributeRewards(
    address indexed sender,
    uint256 yCrvReward,
    uint256 usdcConverted,
    uint256 yfiConverted,
    uint256 yfiGain,
    uint256 pvpReward,
    uint256 poolRewardsUnderlying,
    uint256 poolRewardsPi,
    address[] uniswapSwapPath,
    address[] pools
  );
  event ClaimRewards(address indexed sender, uint256 yCrvAmount);
  event Exit(address indexed sender, uint256 redeemAmount, uint256 yCrvAmount);

  struct YearnConfig {
    address YCRV;
    address USDC;
    address YFI;
    address payable uniswapRouter;
    address curveYDeposit;
    address[] usdcYfiSwapPath;
  }

  int128 internal constant USDC_CURVE_Y_INDEX = 1;

  address public immutable curveYDeposit;
  IERC20 public immutable YCRV;
  IERC20 public immutable USDC;
  IERC20 public immutable YFI;

  address payable public uniswapRouter;
  address[] public usdcYfiSwapPath;

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    YearnConfig memory _yearnConfig
  ) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    require(_yearnConfig.curveYDeposit != address(0), "INVALID_YDEPOSIT_ADDR");
    require(_yearnConfig.YCRV != address(0), "INVALID_YCRV_ADDR");
    require(_yearnConfig.USDC != address(0), "INVALID_USDC_ADDR");
    require(_yearnConfig.YFI != address(0), "INVALID_YFI_ADDR");

    YCRV = IERC20(_yearnConfig.YCRV);
    USDC = IERC20(_yearnConfig.USDC);
    YFI = IERC20(_yearnConfig.YFI);
    uniswapRouter = _yearnConfig.uniswapRouter;
    curveYDeposit = _yearnConfig.curveYDeposit;
    usdcYfiSwapPath = _yearnConfig.usdcYfiSwapPath;
  }

  function _claimRewards() internal override {
    // Step #1. Claim yCrv reward from YFI governance pool
    _callVoting(YearnGovernanceInterface(0).getReward.selector, "");

    uint256 yCrvReward = YCRV.balanceOf(address(piToken));
    require(yCrvReward > 0, "NO_YCRV_REWARD_ON_PI");

    // Step #2. Transfer yCrv reward to the router
    piToken.callExternal(address(YCRV), YCRV.transfer.selector, abi.encode(address(this), yCrvReward), 0);

    emit ClaimRewards(msg.sender, yCrvReward);
  }

  function exit() external {
    _checkVotingSenderAllowed();

    uint256 yfiBalanceBefore = YFI.balanceOf(address(piToken));

    // Step #1. Exit (get all the stake back) and claim yCrv reward from YFI governance pool
    _callVoting(YearnGovernanceInterface(0).exit.selector, "");

    uint256 yfiBalanceAfter = YFI.balanceOf(address(piToken));

    // Step #2. Transfer yCrv reward to the router
    uint256 yCrvReward = YCRV.balanceOf(address(piToken));
    if (yCrvReward > 0) {
      piToken.callExternal(address(YCRV), YCRV.transfer.selector, abi.encode(address(this), yCrvReward), 0);
    }

    emit Exit(msg.sender, yfiBalanceAfter - yfiBalanceBefore, yCrvReward);
  }

  function distributeRewards() external {
    _checkVotingSenderAllowed();

    _distributeRewards();
  }

  function _distributeRewards() internal override {
    uint256 poolsLen = rewardPools.length;
    require(poolsLen > 0, "MISSING_REWARD_POOLS");
    require(usdcYfiSwapPath.length > 0, "MISSING_REWARD_SWAP_PATH");

    uint256 yfiBalanceBefore = YFI.balanceOf(address(this));
    uint256 yCrvReward = YCRV.balanceOf(address(this));
    require(yCrvReward > 0, "NO_YCRV_REWARD_ON_ROUTER");

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

    // Step #5. Distribute pvpReward
    (uint256 pvpReward, uint256 poolRewards) = _distributeRewardToPvp(yfiGain, YFI);
    require(poolRewards > 0, "NO_POOL_REWARDS");

    // Step #6. Wrap gained yfi into piYfi
    YFI.approve(address(piToken), poolRewards);
    piToken.deposit(poolRewards);

    // Step #7. Distribute piYfi leftovers over the pools
    (uint256 piBalanceToDistribute, address[] memory pools) = _distributePiRemainderToPools(piToken);

    emit DistributeRewards(
      msg.sender,
      yCrvReward,
      usdcConverted,
      yfiConverted,
      yfiGain,
      pvpReward,
      poolRewards,
      piBalanceToDistribute,
      usdcYfiSwapPath,
      pools
    );

    // NOTICE: it's ok to keep some YFI dust here for the future swaps
  }

  /*** OWNER METHODS ***/

  function setUniswapRouter(address payable _unsiwapRouter) external onlyOwner {
    uniswapRouter = _unsiwapRouter;
    emit SetUniswapRouter(_unsiwapRouter);
  }

  function setUsdcYfiSwapPath(address[] calldata _usdcYfiSwapPath) external onlyOwner {
    require(_usdcYfiSwapPath[0] == address(USDC), "0_NOT_USDC");
    require(_usdcYfiSwapPath[_usdcYfiSwapPath.length - 1] == address(YFI), "LAST_NOT_YFI");

    usdcYfiSwapPath = _usdcYfiSwapPath;
    emit SetUsdcYfiSwapPath(_usdcYfiSwapPath);
  }

  /*** THE PROXIED METHOD EXECUTORS ***/

  function callRegister() external {
    _checkVotingSenderAllowed();
    _callVoting(YearnGovernanceInterface(0).register.selector, "");
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

  /*** POKE FUNCTION ***/

  function _rebalancePoke(ReserveStatus status, uint256 diff) internal override {
    require(staking != address(0), "STACKING_IS_NULL");

    YearnGovernanceInterface _voting = YearnGovernanceInterface(voting);

    if (status == ReserveStatus.SHORTAGE) {
      uint256 voteLockUntilBlock = _voting.voteLock(address(piToken));
      require(voteLockUntilBlock < block.number, "VOTE_LOCK");
      _redeem(diff);
    } else if (status == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  /*** VIEWERS ***/

  function getUsdcYfiSwapPath() external view returns (address[] memory) {
    return usdcYfiSwapPath;
  }

  /*** INTERNALS ***/

  function _getUnderlyingStaked() internal view override returns (uint256) {
    return YearnGovernanceInterface(voting).balanceOf(address(piToken));
  }

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    piToken.approveUnderlying(voting, _amount);
    _callVoting(YearnGovernanceInterface(0).stake.selector, abi.encode(_amount));

    emit Stake(msg.sender, _amount);
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_REDEEM_0");

    _callVoting(YearnGovernanceInterface(0).withdraw.selector, abi.encode(_amount));

    emit Redeem(msg.sender, _amount);
  }
}
