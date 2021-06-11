// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./MockERC20.sol";
import "../interfaces/ICurveDepositor.sol";
import "../interfaces/ICurveZapDepositor.sol";

contract MockCurveDepositor is ICurveDepositor, ICurveZapDepositor {
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

  function calc_withdraw_one_coin(uint256 _tokenAmount, int128) public view override returns (uint256) {
    return _tokenAmount.mul(rate).div(1e30);
  }

  function calc_withdraw_one_coin(address _pool, uint256 _tokenAmount, int128) public view override returns (uint256) {
    return calc_withdraw_one_coin(_tokenAmount, 0);
  }

  function remove_liquidity_one_coin(
    uint256 _tokenAmount,
    int128 _i,
    uint256 _minAmount
  ) public override {
    uint256 calculated = calc_withdraw_one_coin(_tokenAmount, _i);
    require(calculated >= _minAmount, "REMOVE_MIN_AMOUNT");
    usdc.transfer(msg.sender, calculated);
  }

  function remove_liquidity_one_coin(
    address _pool,
    uint256 _tokenAmount,
    int128 _i,
    uint256 _minAmount
  ) public override {
    remove_liquidity_one_coin(_tokenAmount, _i, _minAmount);
  }
}
