// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../interfaces/sushi/IMasterChefV1.sol";
import "../../interfaces/IBakeryMasterChef.sol";
import "./AbstractMasterChefIndexRouter.sol";

/**
 * Compatible with:
 * - Bakery: https://bscscan.com/address/0x20ec291bb8459b6145317e7126532ce7ece5056f,
 *   pending rewards via pendingBake(pid, user)
 */
contract BakeryChefPowerIndexRouter is AbstractMasterChefIndexRouter {
  struct BakeryMasterChefConfig {
    address token;
  }

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    BakeryMasterChefConfig memory _masterChefConfig
  ) public AbstractMasterChefIndexRouter(_masterChefConfig.token) PowerIndexBasicRouter(_piToken, _basicConfig) {}

  /*** VIEWERS ***/

  function getPendingRewards() external view returns (uint256 amount) {
    return IBakeryMasterChef(staking).pendingBake(address(TOKEN), address(piToken));
  }

  /*** OVERRIDES ***/

  function _getUnderlyingStaked() internal view override returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }
    (uint256 amount, ) = IBakeryMasterChef(staking).poolUserInfoMap(address(TOKEN), address(piToken));
    return amount;
  }

  function _stakeImpl(uint256 _amount) internal override {
    _callStaking(IBakeryMasterChef.deposit.selector, abi.encode(address(TOKEN), _amount));
  }

  function _redeemImpl(uint256 _amount) internal override {
    _callStaking(IBakeryMasterChef.withdraw.selector, abi.encode(address(TOKEN), _amount));
  }
}
