// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract MockOracle {
  mapping(address => uint256) public prices;

  constructor() public {}

  function setPrice(address token, uint256 price) public {
    prices[token] = price;
  }

  function assetPrices(address token) public view returns (uint256) {
    return prices[token];
  }

  function getPriceByAsset(address token) public view returns (uint256) {
    return prices[token];
  }
}
