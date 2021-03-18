// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "../../PowerIndexPoolController.sol";
pragma experimental ABIEncoderV2;

contract PoolManagement is OwnableUpgradeSafe {
  event AddPool(address indexed pool, address indexed poolController);
  event SetPool(address indexed pool, address indexed poolController, bool indexed active);

  struct Pool {
    PowerIndexPoolController controller;
    PowerIndexWrapperInterface wrapper;
    uint256 lastWeightsUpdate;
    bool active;
  }

  address[] public pools;
  mapping(address => Pool) public poolsData;

  function addPool(
    address _poolAddress,
    address _controller,
    address _wrapper
  ) external onlyOwner {
    require(address(poolsData[_poolAddress].controller) == address(0), "ALREADY_EXIST");
    require(_controller != address(0), "CONTROLLER_CANT_BE_NULL");
    pools.push(_poolAddress);
    poolsData[_poolAddress].controller = PowerIndexPoolController(_controller);
    poolsData[_poolAddress].wrapper = PowerIndexWrapperInterface(_wrapper);
    poolsData[_poolAddress].active = true;
    emit AddPool(_poolAddress, _controller);
  }

  function setPool(
    address _poolAddress,
    address _controller,
    address _wrapper,
    bool _active
  ) external onlyOwner {
    require(_controller != address(0), "CONTROLLER_CANT_BE_NULL");
    poolsData[_poolAddress].controller = PowerIndexPoolController(_controller);
    poolsData[_poolAddress].wrapper = PowerIndexWrapperInterface(_wrapper);
    poolsData[_poolAddress].active = _active;
    emit SetPool(_poolAddress, _controller, _active);
  }

  function pausePool(address _poolAddress) external onlyOwner {
    poolsData[_poolAddress].active = false;
    PowerIndexPoolInterface pool = PowerIndexPoolInterface(_poolAddress);
    address[] memory tokens = pool.getCurrentTokens();

    uint256 len = tokens.length;
    PowerIndexPoolController.DynamicWeightInput[] memory dws;
    dws = new PowerIndexPoolController.DynamicWeightInput[](len);

    for (uint256 i = 0; i < len; i++) {
      dws[i].token = tokens[i];
      dws[i].fromTimestamp = block.timestamp + 1;
      dws[i].targetTimestamp = block.timestamp + 2;
      dws[i].targetDenorm = pool.getDenormalizedWeight(tokens[i]);
    }

    poolsData[_poolAddress].controller.setDynamicWeightListByStrategy(dws);
  }

  function getPoolsList() external view returns (address[] memory) {
    return pools;
  }

  function getPoolsLength() external view returns (uint256) {
    return pools.length;
  }

  function getActivePoolsList() external view returns (address[] memory output) {
    uint256 len = pools.length;
    uint256 activeLen = 0;

    for (uint256 i; i < len; i++) {
      if (poolsData[pools[i]].active) {
        activeLen++;
      }
    }

    output = new address[](activeLen);
    uint256 ai;
    for (uint256 i; i < len; i++) {
      if (poolsData[pools[i]].active) {
        output[ai++] = pools[i];
      }
    }
  }
}
