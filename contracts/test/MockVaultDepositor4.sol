// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MockERC20.sol";
import "../interfaces/IVaultDepositor4.sol";

contract MockVaultDepositor4 is IVaultDepositor4 {
  using SafeMath for uint256;

  MockERC20 public token;
  MockERC20 public usdc;
  uint256 public index;
  uint256 public rate;

  constructor(address _token, address _usdc, uint256 _index, uint256 _rate) public {
    token = MockERC20(_token);
    usdc = MockERC20(_usdc);
    index = _index;
    rate = _rate;
  }

  function add_liquidity(uint256[4] memory _amounts, uint256 _min_mint_amount) external override {
    require(_amounts[index] != 0, "NULL_ADD_LIQUIDITY_AMOUNT");
    uint256 out = _amounts[index].mul(1 ether).div(rate);
    usdc.transferFrom(msg.sender, address(this), _amounts[index]);
    token.mint(msg.sender, out);
  }

  function calc_token_amount(uint256[4] memory _amounts, bool _deposit) external override view returns (uint256) {
    require(_amounts[index] != 0, "NULL_ADD_LIQUIDITY_AMOUNT");
    return _amounts[index].mul(1 ether).div(rate);
  }
}
