// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../../interfaces/IPiRouterFactory.sol";
import "../../PowerIndexBasicRouter.sol";

contract BasicPowerIndexRouterFactory is IPiRouterFactory {
  event BuildBasicRouter(address indexed builder, address indexed router);

  function buildRouter(address _piToken, bytes calldata _args) external override returns (address) {
    address poolRestrictions = abi.decode(_args, (address));

    address router = address(new PowerIndexBasicRouter(_piToken, poolRestrictions));

    emit BuildBasicRouter(msg.sender, router);

    return router;
  }
}
