// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../../interfaces/IPiRouterFactory.sol";
import "../../PowerIndexBasicRouter.sol";

contract BasicPowerIndexRouterFactory is IPiRouterFactory {
  event BuildBasicRouter(address indexed builder, address indexed router);

  function buildRouter(address _piToken, address _poolRestrictions) external override returns (address) {
    address router = address(new PowerIndexBasicRouter(_piToken, _poolRestrictions));

    emit BuildBasicRouter(msg.sender, router);

    return router;
  }
}
