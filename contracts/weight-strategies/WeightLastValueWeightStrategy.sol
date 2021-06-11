// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./WeightValueStrategy.sol";

contract WeightLastValueWeightStrategy is WeightValueStrategy {
  mapping(address => mapping(address => uint256)) public lastValue;

  constructor() public OwnableUpgradeSafe() {}

  function _updatePoolByPoke(
    address _pool,
    address[] memory _tokens,
    uint256[] memory _newTokenValues
  ) internal override {
    poolsData[_pool].lastWeightsUpdate = block.timestamp;

    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      lastValue[_pool][_tokens[i]] = _newTokenValues[i];
    }
  }
}
