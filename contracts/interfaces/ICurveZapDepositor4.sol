// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ICurveZapDepositor4 {
  function add_liquidity(
    address _pool,
    uint256[4] memory _amounts,
    uint256 _min_mint_amount
  ) external;

  function calc_token_amount(
    address _pool,
    uint256[4] memory _amounts,
    bool _deposit
  ) external view returns (uint256);
}
