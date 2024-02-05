pragma solidity 0.8.11;

import "hardhat/console.sol";

  struct Pool {
    address lpToken; // address of the LP token contract
    bool votesEnabled; // if the pool is enabled to write votes
    uint8 poolType; // pool type (1 - Uniswap, 2 - Balancer)
    uint32 allocPoint; // points assigned to the pool, which affect CVPs distribution between pools
    uint32 lastUpdateBlock; // latest block when the pool params which follow was updated
    uint256 accCvpPerLpt; // accumulated distributed CVPs per one deposited LP token, times 1e12
  }

interface IUniswapV2Router {
  function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

interface IVestedLpMining {
  function pools(uint256 index) external view returns (Pool calldata);

  function poolLength() external view returns(uint);
}

contract PoolsLens {
  IVestedLpMining public mining;
  IUniswapV2Router public uniRouter;

  address public usdtAddress;

  constructor(
    IVestedLpMining _mining,
    IUniswapV2Router _router,
    address _usdtAddress
  ) public {
    mining = _mining;
    uniRouter = _router;
    usdtAddress = _usdtAddress;
  }

  // get an array of pools
  function getPools() internal view returns (Pool[] memory) {
    uint256 poolsLength = mining.poolLength();
    Pool[] memory pools = new Pool[](poolsLength);
    for (uint256 i = 0; i < poolsLength; i++) {
      pools[i] = mining.pools(i);
    }
    return pools;
  }

  function getPoolEsentialData(uint8 poolId) external view returns (Pool memory) {
    Pool[] memory pools = getPools();
    return pools[poolId];
  }
}
