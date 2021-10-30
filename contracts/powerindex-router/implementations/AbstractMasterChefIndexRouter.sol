// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/sushi/IMasterChefV1.sol";
import "../PowerIndexBasicRouter.sol";

abstract contract AbstractMasterChefIndexRouter is PowerIndexBasicRouter {
  event Stake(address indexed sender, uint256 amount, uint256 rewardReceived);
  event Redeem(address indexed sender, uint256 amount, uint256 rewardReceived);
  event IgnoreDueMissingStaking();
  event ClaimRewards(address indexed sender, uint256 earned);

  IERC20 internal immutable TOKEN;

  constructor(address _token) public {
    TOKEN = IERC20(_token);
  }

  /*** PERMISSIONLESS REWARD CLAIMING AND DISTRIBUTION ***/

  function _claimRewards(ReserveStatus status) internal override {
    if (status == ReserveStatus.EQUILIBRIUM) {
      uint256 tokenBefore = TOKEN.balanceOf(address(piToken));
      _stake(0);
      uint256 receivedReward = TOKEN.balanceOf(address(piToken)).sub(tokenBefore);
      if (receivedReward > 0) {
        _distributeReward(TOKEN, receivedReward);
      }
    }
    // Otherwise the rewards are distributed each time deposit/withdraw methods are called,
    // so no additional actions required.
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
    require(staking != address(0), "STAKING_IS_NULL");

    if (reserveStatus == ReserveStatus.SHORTAGE) {
      _redeem(diff);
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  /*** INTERNALS ***/

  // TODO: ensure is ok
  function _getUnderlyingReserve() internal view override returns (uint256) {
    return TOKEN.balanceOf(address(piToken));
  }

  function _stake(uint256 _amount) internal {
    uint256 tokenBefore = TOKEN.balanceOf(address(piToken));

    piToken.approveUnderlying(staking, _amount);

    _stakeImpl(_amount);

    uint256 receivedReward = TOKEN.balanceOf(address(piToken)).sub(tokenBefore.sub(_amount));

    _distributeReward(TOKEN, receivedReward);

    emit Stake(msg.sender, _amount, receivedReward);
  }

  function _redeem(uint256 _amount) internal {
    uint256 tokenBefore = TOKEN.balanceOf(address(piToken));

    _redeemImpl(_amount);

    uint256 receivedReward = TOKEN.balanceOf(address(piToken)).sub(tokenBefore).sub(_amount);

    _distributeReward(TOKEN, receivedReward);

    emit Redeem(msg.sender, _amount, receivedReward);
  }

  function _stakeImpl(uint256 _amount) internal virtual;

  function _redeemImpl(uint256 _amount) internal virtual;
}
