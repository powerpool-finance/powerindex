// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../../interfaces/IPiRouterFactory.sol";
import "../../PowerIndexBasicRouter.sol";

contract BasicPowerIndexRouterFactory is IPiRouterFactory {
  event BuildBasicRouter(address indexed builder, address indexed piToken, address indexed router);

  function buildRouter(address _piToken, bytes calldata _args) external override returns (address) {
    PowerIndexBasicRouter.BasicConfig memory _basicConfig = abi.decode(_args, (PowerIndexBasicRouter.BasicConfig));

    address router = address(new PowerIndexBasicRouter(_piToken, _basicConfig));

    emit BuildBasicRouter(msg.sender, _piToken, router);

    Ownable(router).transferOwnership(msg.sender);

    return router;
  }
}
