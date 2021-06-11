// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../weight-strategies/YearnVaultInstantRebindStrategy.sol";

contract MockYearnVaultInstantRebindStrategy is YearnVaultInstantRebindStrategy {
  constructor(address _pool, address _usdc) public YearnVaultInstantRebindStrategy(_pool, _usdc) {}

  function mockPoke() external {
    _poke(false);
  }
}
