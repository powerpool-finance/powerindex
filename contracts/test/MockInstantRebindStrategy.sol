// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../weight-strategies/InstantRebindStrategy.sol";

contract MockInstantRebindStrategy is InstantRebindStrategy {
  constructor(address _pool, address _usdc) public InstantRebindStrategy(_pool, _usdc) {}

  function mockPoke() external {
    _poke(false);
  }
}
