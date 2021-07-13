// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@powerpool/power-oracle/contracts/interfaces/IPowerPoke.sol";
import "../interfaces/IPoolRestrictions.sol";

contract CVPMakerStorage is OwnableUpgradeSafe {
  IPowerPoke public powerPoke;

  uint256 public cvpAmountOut;

  uint256 public lastReporterPokeFrom;

  IPoolRestrictions public restrictions;

  // token => router
  mapping(address => address) public routers;

  // token => [path, to, cvp]
  mapping(address => address[]) public customPaths;

  // token => strategyId
  mapping(address => uint256) public customStrategies;

  struct ExternalStrategiesConfig {
    address strategy;
    bool maxAmountIn;
    bytes config;
  }

  // token => strategyAddress
  mapping(address => ExternalStrategiesConfig) public externalStrategiesConfig;

  struct Strategy1Config {
    address bPoolWrapper;
  }

  struct Strategy2Config {
    address bPoolWrapper;
    uint256 nextIndex;
    address[] tokens;
  }

  struct Strategy3Config {
    address bPool;
    address bPoolWrapper;
    address underlying;
  }

  struct Strategy4Config {
    address zap;
    address outputToken;
  }

  mapping(address => Strategy1Config) public strategy1Config;

  mapping(address => Strategy2Config) public strategy2Config;

  mapping(address => Strategy3Config) public strategy3Config;

  mapping(address => Strategy4Config) public strategy4Config;
}
