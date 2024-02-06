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

  struct LpData {
    uint256 tvl;
    uint256 apy;
  }

  struct ReservesStruct {
    uint112 reserve0;
    uint112 reserve1;
    uint32 blockTimestampLast;
  }

interface IUniswapV2Router {
  function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

interface IVestedLpMining {
  function pools(uint256 index) external view returns (Pool calldata);

  function poolLength() external view returns(uint);
}

interface ILpToken {
  function getReserves() external view returns (ReservesStruct calldata);
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

  function getPoolData(uint8 poolId) external view returns (LpData memory) {
    Pool[] memory pools = getPools();
    Pool memory pool = pools[poolId];

    if (poolId == 0) {
      // tvl calculation
      ReservesStruct memory reserves = ILpToken(pool.lpToken).getReserves();
      address[] memory path = new address[](3);
      address cvpAddress = 0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1;
      address wethAddress = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
      address usdcAddress = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
      address[] memory cvpPath = new address[](3);
      cvpPath[0] = cvpAddress;
      cvpPath[1] = wethAddress;
      cvpPath[2] = usdcAddress;
      address[] memory ethPath = new address[](2);
      ethPath[0] = wethAddress;
      ethPath[1] = usdcAddress;

      uint256 cvpPrice = uniRouter.getAmountsOut(1 ether, cvpPath)[2];
      uint256 ethPrice = uniRouter.getAmountsOut(1 ether, ethPath)[1];

      uint256 tvl = ((reserves.reserve0 * cvpPrice) + (reserves.reserve1 * ethPrice));

      // apy calculation
      return LpData({
        tvl: tvl / 10 ** 6 / 1 ether,
        apy: 0
      });
    }
    return LpData({
      tvl: 0,
      apy: 0
    });
  }
}
