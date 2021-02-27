// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./WeightValueStrategy.sol";

contract TvlWeightStrategy is WeightValueStrategy {
  mapping(address => mapping(address => uint256)) public lastTvl;

  constructor() public OwnableUpgradeSafe() {}

  function getTokenValue(PowerIndexPoolInterface _pool, address _token) public view override returns (uint256) {
    uint256 lastTokenTvl = lastTvl[address(_pool)][_token];
    if (lastTokenTvl == 0) {
      return getTVL(_pool, _token);
    } else {
      return badd(lastTokenTvl, getTVL(_pool, _token)) / 2;
    }
  }

  function _updatePoolByPoke(
    address _pool,
    address[] memory _tokens,
    uint256[] memory _newTokenValues
  ) internal override {
    poolsData[_pool].lastWeightsUpdate = block.timestamp;

    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      lastTvl[_pool][_tokens[i]] = _newTokenValues[i];
    }
  }
}
