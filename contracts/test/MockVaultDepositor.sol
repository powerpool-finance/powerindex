// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MockERC20.sol";

contract MockVaultDepositor {
  using SafeMath for uint256;

  MockERC20 public token;
  MockERC20 public usdc;
  uint256 public index;
  uint256 public rate;

  constructor(
    address _token,
    address _usdc,
    uint256 _index,
    uint256 _rate
  ) public {
    token = MockERC20(_token);
    usdc = MockERC20(_usdc);
    index = _index;
    rate = _rate;
  }

  function _remove_liquidity_one_coin(
    uint256 _token_amount,
    int128 _i,
    uint256 _min_amount
  ) internal {
    require(_token_amount != 0, "NULL_REMOVE_LIQUIDITY_AMOUNT");
    uint256 out = _token_amount.mul(rate).div(1e30);
    usdc.transfer(msg.sender, out);
  }
}
