// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract MockVaultRegistry {

  mapping(address => uint256) private virtual_prices;

  constructor() public {}

  function set_virtual_price(address _token, uint256 _amount) external {
    virtual_prices[_token] = _amount;
  }

  function get_virtual_price_from_lp_token(address _token) external view returns (uint256) {
    return virtual_prices[_token];
  }
}
