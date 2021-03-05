// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./WeightLastValueWeightStrategy.sol";
import "../interfaces/IVault.sol";

contract VaultBalanceWeightStrategy is WeightLastValueWeightStrategy {
  constructor() public OwnableUpgradeSafe() {}

  function getTokenValue(PowerIndexPoolInterface _pool, address _token) public view override returns (uint256) {
    uint256 lastTokenBalance = lastValue[address(_pool)][_token];
    if (lastTokenBalance == 0) {
      return getVaultBalance(_token);
    } else {
      return badd(lastTokenBalance, getVaultBalance(_token)) / 2;
    }
  }

  function getVaultBalance(address _token) public view returns (uint256) {
    return IVault(_token).balance();
  }
}
