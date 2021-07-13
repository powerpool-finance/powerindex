// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/sushi/IMasterChefV1.sol";
import "./AbstractMasterChefIndexRouter.sol";

/**
 * Compatible with:
 * - MDEX: https://bscscan.com/address/0x6aee12e5eb987b3be1ba8e621be7c4804925ba68,
 *   pending rewards via pending(pid, user)
 * - Bakery: https://bscscan.com/address/0x20ec291bb8459b6145317e7126532ce7ece5056f,
 *   pending rewards via pendingBake(pid, user)
 * - Auto: https://bscscan.com/address/0x763a05bdb9f8946d8c3fa72d1e0d3f5e68647e5c,
 *   pending rewards via stakedWantTokens(pid, user)
 */
contract MasterChefPowerIndexRouter is AbstractMasterChefIndexRouter {
  uint256 internal immutable MASTER_CHEF_PID;

  struct MasterChefConfig {
    address token;
    uint256 masterChefPid;
  }

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    MasterChefConfig memory _masterChefConfig
  ) public AbstractMasterChefIndexRouter(_masterChefConfig.token) PowerIndexBasicRouter(_piToken, _basicConfig) {
    MASTER_CHEF_PID = _masterChefConfig.masterChefPid;
  }

  /*** OVERRIDES ***/

  function _getUnderlyingStaked() internal view override returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }
    (uint256 amount, ) = IMasterChefV1(staking).userInfo(MASTER_CHEF_PID, address(piToken));
    return amount;
  }

  function _rewards() internal override {
    _callStaking(IMasterChefV1.deposit.selector, abi.encode(MASTER_CHEF_PID, 0));
  }

  function _stake(uint256 _amount) internal override {
    require(_amount > 0, "CANT_STAKE_0");

    piToken.approveUnderlying(staking, _amount);
    _callStaking(IMasterChefV1.deposit.selector, abi.encode(MASTER_CHEF_PID, _amount));

    emit Stake(msg.sender, _amount);
  }

  function _redeem(uint256 _amount) internal override {
    require(_amount > 0, "CANT_REDEEM_0");

    _callStaking(IMasterChefV1.withdraw.selector, abi.encode(MASTER_CHEF_PID, _amount));

    emit Redeem(msg.sender, _amount);
  }
}
