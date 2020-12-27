// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../../../interfaces/IPiRouterFactory.sol";
import "../YearnPowerIndexRouter.sol";

contract YearnPowerIndexRouterFactory is IPiRouterFactory {
  event BuildYearnRouter(address indexed builder, address indexed router);

  function buildRouter(address _piToken, bytes calldata _args) external override returns (address) {
    (
      address _poolRestrictions,
      address _YCRV,
      address _USDC,
      address _YFI,
      address payable _uniswapRouter,
      address _curveYDeposit,
      address _pvp,
      uint256 _pvpFee,
      address[] memory _rewardPools,
      address[] memory _usdcYfiSwapPath
    ) =
      abi.decode(_args, (address, address, address, address, address, address, address, uint256, address[], address[]));

    address router =
      address(
        new YearnPowerIndexRouter(
          _piToken,
          _poolRestrictions,
          _YCRV,
          _USDC,
          _YFI,
          _uniswapRouter,
          _curveYDeposit,
          _pvp,
          _pvpFee,
          _rewardPools,
          _usdcYfiSwapPath
        )
      );

    emit BuildYearnRouter(msg.sender, router);

    return router;
  }
}
