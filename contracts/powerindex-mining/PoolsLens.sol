/*
https://powerpool.finance/
          wrrrw r wrr
         ppwr rrr wppr0       prwwwrp                                 prwwwrp                   wr0
        rr 0rrrwrrprpwp0      pp   pr  prrrr0 pp   0r  prrrr0  0rwrrr pp   pr  prrrr0  prrrr0    r0
        rrp pr   wr00rrp      prwww0  pp   wr pp w00r prwwwpr  0rw    prwww0  pp   wr pp   wr    r0
        r0rprprwrrrp pr0      pp      wr   pr pp rwwr wr       0r     pp      wr   pr wr   pr    r0
         prwr wrr0wpwr        00        www0   0w0ww    www0   0w     00        www0    www0   0www0
          wrr ww0rrrr
*/

// SPDX-License-Identifier: MIT

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
  function cvpPerBlock() external view returns (uint96);
  function totalAllocPoint() external view returns (uint256);

  function poolLength() external view returns(uint);
}

interface ILpToken {
  function getReserves() external view returns (ReservesStruct calldata);
}

contract PoolsLens is Ownable {
  IVestedLpMining public mining;
  IUniswapV2Router public uniRouter;

  address public stableAddress;
  address public wethAddress;
  mapping(address => address[]) public pathByToken;

  constructor(
    IVestedLpMining _mining,
    IUniswapV2Router _router,
    address _stableAddress,
    address _wethAddress
  ) {
    mining = _mining;
    uniRouter = _router;
    stableAddress = _stableAddress;
    wethAddress = _wethAddress;
    pathByToken[wethAddress] = [_wethAddress, _stableAddress];
  }

  // Get called when wETH address is changed or stable token has changed
  function setWethAddress(address _wethAddress) public onlyOwner {
    address[] memory newPath = new address[](2);
    newPath[0] = _wethAddress;
    newPath[1] = stableAddress;
    pathByToken[_wethAddress] = newPath;
  }

  // Call that in case stable token changed address
  function changeStable(address _stableAddress) external onlyOwner {
    stableAddress = _stableAddress;
    setWethAddress(wethAddress); // rebuild weth token path;
  }

  // Get called when new token path need to be added. When changing stable, need to be called again!
  function setTokenPath(address _newToken) external onlyOwner {
    address[] memory newPath = new address[](3);
    newPath[0] = _newToken;
    newPath[1] = pathByToken[wethAddress][0];
    newPath[2] = pathByToken[wethAddress][1];

    pathByToken[_newToken] = newPath;
  }

  // just mapping getter for external use
  function getMappingPath(address _index) external view returns (address[] memory) {
    return pathByToken[_index];
  }

  function getPoolData(uint8 poolId) external view returns (LpData memory) {
    Pool memory pool = mining.pools(poolId);

    if (poolId == 0) {
      uint256 stableDecimals = 10 ** 6;
      // tvl calculation
      ReservesStruct memory reserves = ILpToken(pool.lpToken).getReserves();
      address[] memory cvpPath = pathByToken[0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1];
      address[] memory ethPath = pathByToken[wethAddress];

      uint256 cvpPrice = (uniRouter.getAmountsOut(1 ether, cvpPath)[2]);
      uint256 ethPrice = (uniRouter.getAmountsOut(1 ether, ethPath)[1]);

      uint256 tvlInUsd = ((reserves.reserve0 * cvpPrice) + (reserves.reserve1 * ethPrice)) / 1 ether / stableDecimals;

      // apy calculation
      uint256 blocksPerYear = 365 * 7100;
      uint256 cvpPerBlock = mining.cvpPerBlock();
      uint256 poolWeight = ((pool.allocPoint * stableDecimals) / mining.totalAllocPoint());
      uint256 apy = (blocksPerYear * cvpPerBlock * poolWeight * cvpPrice / tvlInUsd) / (10 ** (6 * 4));

      // to get whole apy percents you need to do: apy / 10 ** 5
      return LpData({
        tvl: tvlInUsd,
        apy: apy
      });
    }
    return LpData({
      tvl: 0,
      apy: 0
    });
  }
}
