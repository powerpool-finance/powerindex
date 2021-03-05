// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./WeightLastValueWeightStrategy.sol";
pragma experimental ABIEncoderV2;

contract TvlWeightStrategy is WeightLastValueWeightStrategy {
  constructor() public OwnableUpgradeSafe() {}

  function getTokenValue(PowerIndexPoolInterface _pool, address _token) public view override returns (uint256) {
    uint256 lastTokenValue = lastValue[address(_pool)][_token];
    if (lastTokenValue == 0) {
      return getTVL(_pool, _token);
    } else {
      return badd(lastTokenValue, getTVL(_pool, _token)) / 2;
    }
  }

  function getBalance(PowerIndexPoolInterface _pool, address _token) public view returns (uint256) {
    uint256 balance = _pool.getBalance(_token);
    return bmul(balance, oracle.assetPrices(_token));
  }
}
