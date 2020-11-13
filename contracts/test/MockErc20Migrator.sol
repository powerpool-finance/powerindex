// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockErc20Migrator {
  IERC20 public token1;
  IERC20 public token2;
  address public vault;

  constructor(
    address _token1,
    address _token2,
    address _vault
  ) public {
    token1 = IERC20(_token1);
    token2 = IERC20(_token2);
    vault = _vault;
  }

  function migrate(address _to, uint256 _amount) public {
    require(_amount > 0, "MockErc20Migrator::migrate: No tokens to burn");
    token1.transferFrom(msg.sender, vault, _amount);
    token2.transfer(_to, _amount);
  }
}
