// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./WeightValueAbstract.sol";

abstract contract WeightValueChangeRateAbstract is WeightValueAbstract {
  mapping(address => uint256) public lastValue;
  mapping(address => uint256) public valueChangeRate;

  bool public rateChangeDisabled;

  event UpdatePoolTokenValue(
    address indexed token,
    uint256 oldTokenValue,
    uint256 newTokenValue,
    uint256 lastChangeRate,
    uint256 newChangeRate
  );
  event SetValueChangeRate(address indexed token, uint256 oldRate, uint256 newRate);
  event SetRateChangeDisabled(bool rateChangeDisabled);

  constructor() public WeightValueAbstract() {}

  function _updatePoolByPoke(address _pool, address[] memory _tokens) internal {
    uint256 len = _tokens.length;
    uint256[] memory newTokenValues = new uint256[](len);

    for (uint256 i = 0; i < len; i++) {
      uint256 oldValue = lastValue[_tokens[i]];
      newTokenValues[i] = getTVL(PowerIndexPoolInterface(_pool), _tokens[i]);
      lastValue[_tokens[i]] = newTokenValues[i];

      uint256 lastChangeRate;
      (lastChangeRate, valueChangeRate[_tokens[i]]) = getValueChangeRate(_tokens[i], oldValue, newTokenValues[i]);

      emit UpdatePoolTokenValue(_tokens[i], oldValue, newTokenValues[i], lastChangeRate, valueChangeRate[_tokens[i]]);
    }
  }

  function getValueChangeRate(
    address _token,
    uint256 oldTokenValue,
    uint256 newTokenValue
  ) public view returns (uint256 lastChangeRate, uint256 newChangeRate) {
    lastChangeRate = valueChangeRate[_token] == 0 ? 1 ether : valueChangeRate[_token];
    if (oldTokenValue == 0) {
      newChangeRate = lastChangeRate;
      return (lastChangeRate, newChangeRate);
    }
    newChangeRate = rateChangeDisabled ? lastChangeRate : bmul(bdiv(newTokenValue, oldTokenValue), lastChangeRate);
  }

  function getTokenValue(PowerIndexPoolInterface _pool, address _token)
    public
    view
    virtual
    override
    returns (uint256 value)
  {
    value = getTVL(_pool, _token);
    (, uint256 newValueChangeRate) = getValueChangeRate(_token, lastValue[_token], value);
    if (newValueChangeRate != 0) {
      value = bmul(value, newValueChangeRate);
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
