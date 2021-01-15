// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexWrapperInterface {
  function getFinalTokens() external view returns (address[] memory tokens);

  function getCurrentTokens() external view returns (address[] memory tokens);

  function getBalance(address _token) external view returns (uint256);

  function setPiTokenForUnderlyingsMultiple(address[] calldata _underlyingTokens, address[] calldata _piTokens)
    external;

  function setPiTokenForUnderlying(address _underlyingTokens, address _piToken) external;

  function updatePiTokenEthFees(address[] calldata _underlyingTokens) external;

  function withdrawOddEthFee(address payable _recipient) external;

  function calcEthFeeForTokens(address[] memory tokens) external view returns (uint256 feeSum);

  function joinPool(uint256 poolAmountOut, uint256[] calldata maxAmountsIn) external payable;

  function exitPool(uint256 poolAmountIn, uint256[] calldata minAmountsOut) external payable;

  function swapExactAmountIn(
    address,
    uint256,
    address,
    uint256,
    uint256
  ) external payable returns (uint256, uint256);

  function swapExactAmountOut(
    address,
    uint256,
    address,
    uint256,
    uint256
  ) external payable returns (uint256, uint256);

  function joinswapExternAmountIn(
    address,
    uint256,
    uint256
  ) external payable returns (uint256);

  function joinswapPoolAmountOut(
    address,
    uint256,
    uint256
  ) external payable returns (uint256);

  function exitswapPoolAmountIn(
    address,
    uint256,
    uint256
  ) external payable returns (uint256);

  function exitswapExternAmountOut(
    address,
    uint256,
    uint256
  ) external payable returns (uint256);
}
