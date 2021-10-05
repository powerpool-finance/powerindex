// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/IPancakeMasterChef.sol";
import "./AbstractMasterChefIndexRouter.sol";

/**
 * Compatible with:
 * - Pancake: https://bscscan.com/address/0x73feaa1ee314f8c655e354234017be2193c9e24e
 * To get pending rewards use IPancakeStaking(0x73feaa1ee314f8c655e354234017be2193c9e24e).pendingCake(0, piToken).
 */
contract PancakeMasterChefIndexRouter is AbstractMasterChefIndexRouter {
  uint256 internal constant PANCAKE_POOL_ID = 0;

  struct PancakeMasterChefConfig {
    address cake;
  }

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    PancakeMasterChefConfig memory _masterChefConfig
  ) public AbstractMasterChefIndexRouter(_masterChefConfig.cake) PowerIndexBasicRouter(_piToken, _basicConfig) {}

  /*** VIEWERS ***/

  function getPendingRewards() external view returns (uint256 amount) {
    return IPancakeMasterChef(staking).pendingCake(PANCAKE_POOL_ID, address(piToken));
  }

  /*** OVERRIDES ***/

  function _getUnderlyingStaked() internal view override returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }
    (uint256 amount, ) = IPancakeMasterChef(staking).userInfo(PANCAKE_POOL_ID, address(piToken));
    return amount;
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callStaking(IPancakeMasterChef.enterStaking.selector, abi.encode(_amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callStaking(IPancakeMasterChef.leaveStaking.selector, abi.encode(_amount));
  }
}
