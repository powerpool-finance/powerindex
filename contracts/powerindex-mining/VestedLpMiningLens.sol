pragma solidity 0.8.11;

import "@openzeppelin/contracts-0.8/access/Ownable.sol";

struct Pool {
  address lpToken; // address of the LP token contract
  bool votesEnabled; // if the pool is enabled to write votes
  uint8 poolType; // pool type (1 - Uniswap, 2 - Balancer)
  uint32 allocPoint; // points assigned to the pool, which affect CVPs distribution between pools
  uint32 lastUpdateBlock; // latest block when the pool params which follow was updated
  uint256 accCvpPerLpt; // accumulated distributed CVPs per one deposited LP token, times 1e12
}

struct PoolBoost {
  uint256 lpBoostRate;
  uint256 cvpBoostRate;
  uint32 lastUpdateBlock;
  uint256 accCvpPerLpBoost;
  uint256 accCvpPerCvpBoost;
}

interface IVestedLpMining {
  function pools(uint256 index) external view returns (Pool calldata);
  function poolBoostByLp(uint256 index) external view returns (PoolBoost calldata);
  function lpBoostRatioByToken(address index) external view returns (uint256);
  function lpBoostMaxRatioByToken(address index) external view returns (uint256);

  function poolLength() external view returns(uint);
}

interface IPiptSwap {
  function calcNeedErc20ToPoolOut(address _swapToken, uint256 _poolAmountOut, uint256 _slippage) external view returns (uint256);
}

contract VestedLpMiningLens is Ownable {
  IVestedLpMining public mining;

  address public usdtAddress;
  mapping(address => address) public piptSwapByPool;

  constructor(IVestedLpMining _mining, address _usdAddress) public {
    mining = _mining;
    usdtAddress = _usdAddress;
  }

  // usual pool but with mixin of lpBoostRatioByToken, lpBoostMaxRatioByToken and poolBoost
  struct AdvancedPool {
    address lpToken;
    bool votesEnabled;
    uint8 poolType;
    uint32 allocPoint;
    uint32 lastUpdateBlock;
    uint256 accCvpPerLpt;
    uint256 lpBoostRatioByToken;
    uint256 lpBoostMaxRatioByToken;
    PoolBoost poolBoost;
  }

  // get an array of pools
  function getPools() external view returns (AdvancedPool[] memory) {
    uint256 poolsLength = mining.poolLength();
    AdvancedPool[] memory pools = new AdvancedPool[](poolsLength);
    for (uint256 i = 0; i < poolsLength; i++) {
      pools[i] = getPool(i);
    }
    return pools;
  }

  // get a single pool
  function getPool(uint256 poolIndex) public view returns (AdvancedPool memory) {
    Pool memory p = mining.pools(poolIndex);
    PoolBoost memory _poolBoost = mining.poolBoostByLp(poolIndex);
    uint256 _lpBoostRatioByToken = mining.lpBoostRatioByToken(p.lpToken);
    uint256 _lpBoostMaxRatioByToken = mining.lpBoostMaxRatioByToken(p.lpToken);
    return AdvancedPool({
      lpToken: p.lpToken,
      votesEnabled: p.votesEnabled,
      poolType: p.poolType,
      allocPoint: p.allocPoint,
      lastUpdateBlock: p.lastUpdateBlock,
      accCvpPerLpt: p.accCvpPerLpt,
      poolBoost: _poolBoost,
      lpBoostRatioByToken: _lpBoostRatioByToken,
      lpBoostMaxRatioByToken: _lpBoostMaxRatioByToken
    });
  }

  function getLpTokenPrice(address lpToken) public view returns (uint256) {
    if (piptSwapByPool[lpToken] == address(0)) {
      // get price from instantUniswapPrice
    } else {
      // get price from calcNeedErc20ToPoolOut
      // slipage is 0.02 eth
      return IPiptSwap(piptSwapByPool[lpToken]).calcNeedErc20ToPoolOut(usdtAddress, 1 ether, 0.02 ether);
    }
    return 0;
  }

  function setPiptSwapByPool(address[] memory poolAddresses, address[] memory piptSwapAddress) external onlyOwner {
    for (uint256 i = 0; i < poolAddresses.length; i++) {
      piptSwapByPool[poolAddresses[i]] = piptSwapAddress[i];
    }
  }
}
