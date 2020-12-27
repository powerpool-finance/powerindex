pragma solidity ^0.6.0;

interface IYDeposit {
  function remove_liquidity_one_coin(
    uint256 tokenAmount,
    int128 i,
    uint256 minAmount,
    bool donateDust
  ) external;
}
