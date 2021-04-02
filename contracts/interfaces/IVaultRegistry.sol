// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IVaultRegistry {
  function get_virtual_price_from_lp_token(address _token) external view returns (uint256);
}
