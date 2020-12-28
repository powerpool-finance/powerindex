// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../../interfaces/IPiRouterFactory.sol";
import "../AavePowerIndexRouter.sol";

contract AavePowerIndexRouterFactory is IPiRouterFactory {
  event BuildAaveRouter(address indexed builder, address indexed router);

  function buildRouter(address _piToken, bytes calldata _args) external override returns (address) {
    PowerIndexBasicRouter.BasicConfig memory _basicConfig = abi.decode(_args, (PowerIndexBasicRouter.BasicConfig));

    address router = address(new AavePowerIndexRouter(_piToken, _basicConfig));

    emit BuildAaveRouter(msg.sender, router);

    return router;
  }
}
