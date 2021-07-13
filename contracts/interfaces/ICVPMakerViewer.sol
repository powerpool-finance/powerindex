// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ICVPMakerViewer {
  function getRouter(address token_) external view returns (address);

  function getPath(address token_) external view returns (address[] memory);

  function getDefaultPath(address token_) external view returns (address[] memory);

  /*** ESTIMATIONS ***/

  function estimateEthStrategyIn() external view returns (uint256);

  function estimateEthStrategyOut(address tokenIn_, uint256 _amountIn) external view returns (uint256);

  function estimateUniLikeStrategyIn(address token_) external view returns (uint256);

  function estimateUniLikeStrategyOut(address token_, uint256 amountIn_) external view returns (uint256);

  /*** CUSTOM STRATEGIES OUT ***/

  function calcBPoolGrossAmount(uint256 tokenAmountNet_, uint256 communityFee_)
    external
    view
    returns (uint256 tokenAmountGross);
}
