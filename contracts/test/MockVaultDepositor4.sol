// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MockERC20.sol";
import "../interfaces/IVaultDepositor4.sol";
import "./MockVaultDepositor.sol";

contract MockVaultDepositor4 is MockVaultDepositor, IVaultDepositor4 {
  using SafeMath for uint256;

  constructor(
    address _token,
    address _usdc,
    uint256 _index,
    uint256 _rate
  ) public MockVaultDepositor(_token, _usdc, _index, _rate) {}

  function add_liquidity(uint256[4] memory _amounts, uint256 _min_mint_amount) external override {
    require(_amounts[index] != 0, "NULL_ADD_LIQUIDITY_AMOUNT");
    uint256 out = _amounts[index].mul(1 ether).div(rate);
    usdc.transferFrom(msg.sender, address(this), _amounts[index]);
    token.mint(msg.sender, out);
  }

  function calc_token_amount(uint256[4] memory _amounts, bool _deposit) external view override returns (uint256) {
    require(_amounts[index] != 0, "NULL_ADD_LIQUIDITY_AMOUNT");
    return _amounts[index].mul(1 ether).div(rate);
  }

  function remove_liquidity_one_coin(
    uint256 _token_amount,
    int128 _i,
    uint256 _min_amount
  ) external override {
    _remove_liquidity_one_coin(_token_amount, _i, _min_amount);
  }
}
