// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ICurveDepositor3 {
  function add_liquidity(uint256[3] memory _amounts, uint256 _min_mint_amount) external;

  function calc_token_amount(uint256[3] memory _amounts, bool _deposit) external view returns (uint256);
}
