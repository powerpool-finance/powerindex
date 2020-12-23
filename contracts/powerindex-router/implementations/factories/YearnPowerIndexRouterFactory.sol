// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../../interfaces/IPiRouterFactory.sol";
import "../YearnPowerIndexRouter.sol";

contract YearnPowerIndexRouterFactory is IPiRouterFactory {
  event BuildYearnRouter(address indexed builder, address indexed router);

  function buildRouter(address _piToken, address _poolRestrictions) external override returns (address) {
    address router = address(new YearnPowerIndexRouter(_piToken, _poolRestrictions));

    emit BuildYearnRouter(msg.sender, router);

    return router;
  }
}
