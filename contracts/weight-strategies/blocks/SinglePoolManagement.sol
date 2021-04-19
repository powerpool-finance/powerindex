// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
pragma experimental ABIEncoderV2;

abstract contract SinglePoolManagement is OwnableUpgradeSafe {
  address public immutable pool;
  address public poolController;

  constructor(address _pool) public {
    pool = _pool;
  }

  function __SinglePoolManagement_init(address _poolController) internal {
    poolController = _poolController;
  }
}
