// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./WeightValueAbstract.sol";
import "hardhat/console.sol";

abstract contract WeightValueChangeRateAbstract is WeightValueAbstract {
  mapping(address => uint256) public lastValue;
  mapping(address => uint256) public valueChangeRate;

  bool public rateChangeDisabled;

  event UpdatePoolTokenValue(address indexed token, uint256 oldTokenValue, uint256 newTokenValue, uint256 lastChangeRate, uint256 newChangeRate);
  event SetValueChangeRate(address indexed token, uint256 oldRate, uint256 newRate);
  event SetRateChangeDisabled(bool rateChangeDisabled);

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

      uint256 lastChangeRate;
      if (oldValue != 0 && !rateChangeDisabled) {
        lastChangeRate = valueChangeRate[_tokens[i]] == 0 ? 1 ether : valueChangeRate[_tokens[i]];
        valueChangeRate[_tokens[i]] = bmul(bdiv(_newTokenValues[i], oldValue), lastChangeRate);
        console.log("valueChangeRate[_tokens[i]]", valueChangeRate[_tokens[i]]);
      }
      emit UpdatePoolTokenValue(_tokens[i], oldValue, _newTokenValues[i], lastChangeRate, valueChangeRate[_tokens[i]]);
    }
  }

  function getTokenValue(PowerIndexPoolInterface _pool, address _token) public view virtual override returns (uint256 value) {
    value = getTVL(_pool, _token);
    if (valueChangeRate[_token] != 0) {
      value = bmul(value, valueChangeRate[_token]);
    }
  }

  function setValueChangeRates(address[] memory _tokens, uint256[] memory _newTokenRates) public onlyOwner {
    uint256 len = _tokens.length;
    require(len == _newTokenRates.length, "LENGTHS_MISMATCH");
    for (uint256 i = 0; i < len; i++) {
      emit SetValueChangeRate(_tokens[i], valueChangeRate[_tokens[i]], _newTokenRates[i]);

      valueChangeRate[_tokens[i]] = _newTokenRates[i];
    }
  }

  function setRateUpdateDisabled(bool _disabled) public onlyOwner {
    rateChangeDisabled = _disabled;
    emit SetRateChangeDisabled(rateChangeDisabled);
  }
}
