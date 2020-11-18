// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

// note "contracts-ethereum-package" (but not "contracts") version of the package
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";

interface ILpTokenMigrator {
  // Perform LP token migration from legacy UniswapV2 to PowerSwap.
  // Take the current LP token address and return the new LP token address.
  // Migrator should have full access to the caller's LP token.
  // Return the new LP token address.
  //
  // XXX Migrator must have allowance access to UniswapV2 LP tokens.
  // PowerSwap must mint EXACTLY the same amount of PowerSwap LP tokens or
  // else something bad will happen. Traditional UniswapV2 does not
  // do that so be careful!
  function migrate(IERC20 token, uint8 poolType) external returns (IERC20);
}
