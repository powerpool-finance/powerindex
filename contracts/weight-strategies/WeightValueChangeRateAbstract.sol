// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./WeightValueAbstract.sol";
import "hardhat/console.sol";

abstract contract WeightValueChangeRateAbstract is WeightValueAbstract {
  mapping(address => uint256) public lastValue;
  mapping(address => uint256) public valueChangeRate;

  constructor() public WeightValueAbstract() {}

  function _updatePoolByPoke(
    address _pool,
    address[] memory _tokens,
    uint256[] memory _newTokenValues
  ) internal {
    console.log("_updatePoolByPoke");
    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      uint256 oldValue = lastValue[_tokens[i]];
      lastValue[_tokens[i]] = _newTokenValues[i];
      console.log("_newTokenValues[i]", _newTokenValues[i]);

      if (oldValue != 0) {
        uint256 lastChangeRate = valueChangeRate[_tokens[i]] == 0 ? 1 ether : valueChangeRate[_tokens[i]];
        valueChangeRate[_tokens[i]] = bmul(bdiv(_newTokenValues[i], oldValue), lastChangeRate);
        console.log("valueChangeRate[_tokens[i]]", valueChangeRate[_tokens[i]]);
      }
    }
  }

  function getTokenValue(PowerIndexPoolInterface _pool, address _token) public view virtual override returns (uint256 value) {
    value = getTVL(_pool, _token);
    if (valueChangeRate[_token] != 0) {
      value = bmul(value, valueChangeRate[_token]);
    }
  }

  function setValueChangeRate(address[] memory _tokens, uint256[] memory _newTokenRates) public onlyOwner {
    uint256 len = _tokens.length;
    require(len == _newTokenRates.length, "LENGTHS_MISMATCH");
    for (uint256 i = 0; i < len; i++) {
      valueChangeRate[_tokens[i]] = _newTokenRates[i];
    }
  }
}
