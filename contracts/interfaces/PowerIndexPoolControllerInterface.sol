// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12;

interface PowerIndexPoolControllerInterface {
  function rebindByStrategyAdd(
    address token,
    uint256 balance,
    uint256 denorm,
    uint256 deposit
  ) external;

  function rebindByStrategyRemove(
    address token,
    uint256 balance,
    uint256 denorm
  ) external;
}
