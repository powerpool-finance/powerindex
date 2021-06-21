// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ICVPMakerStrategy {
  // To be called using delegatecall
  function executeStrategy(address token, bytes memory config)
    external
    returns (uint256 amountIn, address executeUniLikeFrom);

  // To be called using call
  function estimateIn(
    address cvpMaker,
    address vaultTokenIn,
    bytes memory config
  ) external view returns (uint256 amountIn);
}
