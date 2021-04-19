// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/ICurvePoolRegistry.sol";

contract MockCurvePoolRegistry is ICurvePoolRegistry {
  mapping(address => uint256) private virtual_prices;

  constructor() public {}

  function set_virtual_price(address _token, uint256 _amount) external {
    virtual_prices[_token] = _amount;
  }

  function get_virtual_price_from_lp_token(address _token) external view override returns (uint256) {
    return virtual_prices[_token];
  }
}
