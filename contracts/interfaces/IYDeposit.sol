// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

interface IYDeposit {
  function remove_liquidity_one_coin(
    uint256 tokenAmount,
    int128 i,
    uint256 minAmount,
    bool donateDust
  ) external;

  function calc_withdraw_one_coin(uint256 _crvTokenAmount, int128 _i) external returns (uint256);
}
