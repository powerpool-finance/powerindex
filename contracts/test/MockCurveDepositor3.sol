// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/ICurveDepositor3.sol";
import "./MockCurveDepositor.sol";

contract MockCurveDepositor3 is MockCurveDepositor, ICurveDepositor3 {
  using SafeMath for uint256;

  constructor(
    address _token,
    address _usdc,
    uint256 _index,
    uint256 _rate
  ) public MockCurveDepositor(_token, _usdc, _index, _rate) {}

  function add_liquidity(uint256[3] memory _amounts, uint256) external override {
    require(_amounts[index] != 0, "NULL_ADD_LIQUIDITY_AMOUNT");
    uint256 out = _amounts[index].mul(1e30).div(rate);
    usdc.transferFrom(msg.sender, address(this), _amounts[index]);
    token.mint(msg.sender, out);
  }

  function calc_token_amount(uint256[3] memory _amounts, bool) external view override returns (uint256) {
    require(_amounts[index] != 0, "NULL_ADD_LIQUIDITY_AMOUNT");
    return _amounts[index].mul(1 ether).div(rate);
  }
}
