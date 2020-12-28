// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../../interfaces/IPiRouterFactory.sol";
import "../YearnPowerIndexRouter.sol";
import "../../PowerIndexBasicRouter.sol";

contract YearnPowerIndexRouterFactory is IPiRouterFactory {
  event BuildYearnRouter(address indexed builder, address indexed piToken, address indexed router);

  function buildRouter(address _piToken, bytes calldata _args) external override returns (address) {
    (PowerIndexBasicRouter.BasicConfig memory _basicConfig, YearnPowerIndexRouter.YearnConfig memory _yearnConfig) =
      abi.decode(_args, (PowerIndexBasicRouter.BasicConfig, YearnPowerIndexRouter.YearnConfig));

    address router = address(new YearnPowerIndexRouter(_piToken, _basicConfig, _yearnConfig));

    emit BuildYearnRouter(msg.sender, _piToken, router);

    Ownable(router).transferOwnership(msg.sender);

    return router;
  }
}
