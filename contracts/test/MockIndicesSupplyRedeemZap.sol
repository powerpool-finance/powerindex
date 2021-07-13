// SPDX-License-Identifier: MIT

pragma experimental ABIEncoderV2;
pragma solidity 0.6.12;

import "../IndicesSupplyRedeemZap.sol";

contract MockIndicesSupplyRedeemZap is IndicesSupplyRedeemZap {
  constructor(address _usdc, address _powerPoke) public IndicesSupplyRedeemZap(_usdc, _powerPoke) {
  }

  function mockSupplyAndRedeemPokeFromReporter(bytes32[] memory _roundKeys) external {
    _supplyAndRedeemPoke(_roundKeys, false);
  }

  function mockClaimPokeFromReporter(bytes32 _roundKey, address[] memory _claimForList) external {
    _claimPoke(_roundKey, _claimForList, false);
  }
}
