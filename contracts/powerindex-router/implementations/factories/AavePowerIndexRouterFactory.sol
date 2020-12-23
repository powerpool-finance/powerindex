// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../../interfaces/IPiRouterFactory.sol";
import "../AavePowerIndexRouter.sol";

contract AavePowerIndexRouterFactory is IPiRouterFactory {
  event BuildAaveRouter(address indexed builder, address indexed router);

  function buildRouter(address _piToken, address _poolRestrictions) external override returns (address) {
    address router = address(new AavePowerIndexRouter(_piToken, _poolRestrictions));

    emit BuildAaveRouter(msg.sender, router);

    return router;
  }
}
