// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ICurveZapDepositor {
  function calc_withdraw_one_coin(
    address _pool,
    uint256 _tokenAmount,
    int128 _index
  ) external view returns (uint256);

  function remove_liquidity_one_coin(
    address _pool,
    uint256 _token_amount,
    int128 _i,
    uint256 _min_amount
  ) external;
}
