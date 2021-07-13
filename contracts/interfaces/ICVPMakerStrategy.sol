// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ICVPMakerStrategy {
  function executeStrategyByAmountOut(
    address poolTokenIn_,
    uint256 tokenOutAmount_,
    bytes memory config_
  )
    external
    returns (uint256 poolTokenInAmount, address executeUniLikeFrom);

  function executeStrategyByAmountIn(
    address poolTokenIn_,
    uint256 tokenInAmount_,
    bytes memory config_
  )
    external
    returns (address executeUniLikeFrom);

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
