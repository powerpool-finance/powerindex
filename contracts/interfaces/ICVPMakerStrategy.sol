// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ICVPMakerStrategy {
  function getExecuteDataByAmountOut(
    address poolTokenIn_,
    uint256 tokenOutAmount_,
    bytes memory config_
  )
    external
    view
    returns (
      uint256 poolTokenInAmount,
      address executeUniLikeFrom,
      bytes memory executeData,
      address executeContract
    );

  function getExecuteDataByAmountIn(
    address poolTokenIn_,
    uint256 tokenInAmount_,
    bytes memory config_
  )
    external
    view
    returns (
      address executeUniLikeFrom,
      bytes memory executeData,
      address executeContract
    );

  function estimateIn(
    address tokenIn_,
    uint256 tokenOutAmount_,
    bytes memory
  ) external view returns (uint256 amountIn);

  function estimateOut(
    address poolTokenIn_,
    uint256 tokenInAmount_,
    bytes memory
  ) external view returns (uint256);

  function getTokenOut() external view returns (address);
}
