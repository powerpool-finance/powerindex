pragma solidity 0.8.11;

struct Pool {
  address lpToken; // address of the LP token contract
  bool votesEnabled; // if the pool is enabled to write votes
  uint8 poolType; // pool type (1 - Uniswap, 2 - Balancer)
  uint32 allocPoint; // points assigned to the pool, which affect CVPs distribution between pools
  uint32 lastUpdateBlock; // latest block when the pool params which follow was updated
  uint256 accCvpPerLpt; // accumulated distributed CVPs per one deposited LP token, times 1e12
}

interface IVestedLpMining {
  function pools(uint256 index) external view returns (Pool calldata);

  function poolLength() external view returns(uint);
}

contract VestedLpMiningLens {
  IVestedLpMining public mining;

  constructor(IVestedLpMining _mining) public {
    mining = _mining;
  }

  function getPools() external view returns (Pool[] memory) {
    uint256 poolsLength = mining.poolLength();
    Pool[] memory pools = new Pool[](poolsLength);
    for (uint256 i = 0; i < poolsLength; i++) {
      Pool memory p = mining.pools(i);
      pools[i] = p;
    }
    return pools;
  }
}
