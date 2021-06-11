// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/ICurveDepositor3.sol";
import "./MockCurveDepositor.sol";
import "../interfaces/ICurveZapDepositor3.sol";

contract MockCurveDepositor3 is MockCurveDepositor, ICurveZapDepositor3, ICurveDepositor3 {
  using SafeMath for uint256;

  constructor(
    address _token,
    address _usdc,
    uint256 _index,
    uint256 _rate
  ) public MockCurveDepositor(_token, _usdc, _index, _rate) {}

  function add_liquidity(uint256[3] memory _amounts, uint256) public override {
    require(_amounts[index] != 0, "NULL_ADD_LIQUIDITY_AMOUNT");
    uint256 out = _amounts[index].mul(1e30).div(rate);
    usdc.transferFrom(msg.sender, address(this), _amounts[index]);
    token.mint(msg.sender, out);
  }

  function calc_token_amount(uint256[3] memory _amounts, bool) public view override returns (uint256) {
    require(_amounts[index] != 0, "NULL_ADD_LIQUIDITY_AMOUNT");
    return _amounts[index].mul(1 ether).div(rate);
  }

  function add_liquidity(address _pool, uint256[3] memory _amounts, uint256) external override {
    add_liquidity(_amounts, 0);
  }

  function calc_token_amount(address _pool, uint256[3] memory _amounts, bool) external view override returns (uint256) {
    return calc_token_amount(_amounts, false);
  }
}
