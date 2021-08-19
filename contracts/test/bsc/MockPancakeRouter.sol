// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract MockPancakeRouter {
  function getAmountsOut(
    uint256, /*amountIn*/
    address[] calldata path
  ) external pure returns (uint256[] memory amounts) {
    amounts = new uint256[](path.length);
  }

  function swapExactTokensForTokensSupportingFeeOnTransferTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    address[] calldata path,
    address to,
    uint256 deadline
  ) external {}
}
