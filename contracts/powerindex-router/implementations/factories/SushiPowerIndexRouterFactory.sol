// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../../interfaces/IPiRouterFactory.sol";
import "../SushiPowerIndexRouter.sol";

contract SushiPowerIndexRouterFactory is IPiRouterFactory {
  event BuildSushiRouter(address indexed builder, address indexed piToken, address indexed router);

  function buildRouter(address _piToken, bytes calldata _args) external override returns (address) {
    (PowerIndexBasicRouter.BasicConfig memory _basicConfig, SushiPowerIndexRouter.SushiConfig memory _sushiConfig) =
      abi.decode(_args, (PowerIndexBasicRouter.BasicConfig, SushiPowerIndexRouter.SushiConfig));

    address router = address(new SushiPowerIndexRouter(_piToken, _basicConfig, _sushiConfig));

    emit BuildSushiRouter(msg.sender, _piToken, router);

    Ownable(router).transferOwnership(msg.sender);

    return router;
  }
}
