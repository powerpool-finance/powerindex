// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../../interfaces/IPiRouterFactory.sol";
import "../AavePowerIndexRouter.sol";

contract AavePowerIndexRouterFactory is IPiRouterFactory {
  event BuildAaveRouter(address indexed builder, address indexed piToken, address indexed router);

  function buildRouter(address _piToken, bytes calldata _args) external override returns (address) {
    (PowerIndexBasicRouter.BasicConfig memory _basicConfig, AavePowerIndexRouter.AaveConfig memory _aaveConfig) =
      abi.decode(_args, (PowerIndexBasicRouter.BasicConfig, AavePowerIndexRouter.AaveConfig));

    address router = address(new AavePowerIndexRouter(_piToken, _basicConfig, _aaveConfig));

    emit BuildAaveRouter(msg.sender, _piToken, router);

    Ownable(router).transferOwnership(msg.sender);

    return router;
  }
}
