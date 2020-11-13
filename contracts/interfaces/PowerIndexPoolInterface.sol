// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./BPoolInterface.sol";

interface PowerIndexPoolInterface is BPoolInterface {
  function bind(
    address,
    uint256,
    uint256,
    uint256,
    uint256
  ) external virtual;

  function setDynamicWeight(
    address token,
    uint256 targetDenorm,
    uint256 fromTimestamp,
    uint256 targetTimestamp
  ) external virtual;

  function getDynamicWeightSettings(address token)
    external
    view
    virtual
    returns (
      uint256 fromTimestamp,
      uint256 targetTimestamp,
      uint256 fromDenorm,
      uint256 targetDenorm
    );
}
