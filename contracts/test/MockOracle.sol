// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

contract MockOracle {
  mapping(address => uint256) public prices;
  mapping(address => address) public wrappers;

  constructor() public {}

  function setPrice(address token, uint256 price) public {
    prices[token] = price;
  }

  function setWrapper(address wrapper, address underlying) public {
    wrappers[wrapper] = underlying;
  }

  function assetPrices(address token) public view returns (uint256) {
    return prices[token];
  }

  function getPriceByAsset(address token) public view returns (uint256) {
    return prices[token];
  }

  function getUnderlyingPrice(address wrapper) public view returns (uint256) {
    return prices[wrappers[wrapper]];
  }
}
