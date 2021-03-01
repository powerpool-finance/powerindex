// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@powerpool/power-oracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IUniswapV2Router02.sol";
import "../interfaces/TokenInterface.sol";
import "../interfaces/BPoolInterface.sol";
import "../balancer-core/BMath.sol";
import "../interfaces/IPoolRestrictions.sol";

contract CVPMakerStorage is OwnableUpgradeSafe {
  IPowerPoke public powerPoke;

  uint256 public cvpAmountOut;

  uint256 public lastReporterPokeFrom;

  IPoolRestrictions internal _restrictions;

  // token => router
  mapping(address => address) public routers;

  // token => [path, to, cvp]
  mapping(address => address[]) public customPaths;

  // token => strategyId
  mapping(address => uint256) public customStrategies;

  struct Strategy2Config {
    uint256 nextIndex;
    address[] tokens;
  }

  struct Strategy3Config {
    address bpool;
  }

  mapping(address => Strategy2Config) public strategy2Config;

  mapping(address => Strategy3Config) public strategy3Config;
}
