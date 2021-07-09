// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ICVPMakerStrategy {
  function executeStrategy(address token, bytes memory config)
    external
    returns (uint256 amountIn, address executeUniLikeFrom);

  function estimateIn(
    address cvpMaker,
    address vaultTokenIn,
    bytes memory config
  ) external view returns (uint256 amountIn);
}
