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
  address immutable public wethAddress;
  address immutable public cvpAddress;
  mapping(address => mapping(address => address[])) public exchangePathByTokens;

  constructor(
    IVestedLpMining _mining,
    IUniswapV2Router _router,
    address _wethAddress,
    address _stableAddress,
    address _cvpAddress
  ) {
    mining = _mining;
    uniRouter = _router;
    wethAddress = _wethAddress;
    stableAddress = _stableAddress;
    cvpAddress = _cvpAddress;

    // Set native path
    address[] memory nativePath = new address[](2);
    nativePath[0] = _wethAddress;
    nativePath[1] = _stableAddress;
    setExchangePath(nativePath);

    // Set cvp path
    address[] memory cvpPath = new address[](3);
    cvpPath[0] = _cvpAddress;
    cvpPath[1] = _wethAddress;
    cvpPath[2] = _stableAddress;
    setExchangePath(cvpPath);
  }

  // A function to change stable token address
  function changeStableAddress(address _newAddress) public onlyOwner {
    stableAddress = _newAddress;
  }

  // Setting an exchange path
  function setExchangePath(address[] memory _exchangePath) public onlyOwner {
    exchangePathByTokens[_exchangePath[0]][_exchangePath[_exchangePath.length - 1]] = _exchangePath;
  }

  // Get price by exchangePathByTokens
  function getAmountsOut(address _tokenFrom, address _tokenTo) public view returns(uint256) {
    uint256[] memory result = uniRouter.getAmountsOut(1 ether, exchangePathByTokens[_tokenFrom][_tokenTo]);
    return result[result.length - 1];
  }

  // just getter for checking mapped addresses. Will be removed on release
  function getMappingPath(address _start, address _end) external view returns (address[] memory) {
    return exchangePathByTokens[_start][_end];
  }

  function getPoolData(uint8 poolId) external view returns (LpData memory) {
    Pool memory pool = mining.pools(poolId);

    if (poolId == 0) {
      uint256 stableDecimals = 10 ** 6;
      // tvl calculation
      ReservesStruct memory reserves = ILpToken(pool.lpToken).getReserves();
      uint256 cvpPrice = getAmountsOut(cvpAddress, stableAddress);
      uint256 ethPrice = getAmountsOut(wethAddress, stableAddress);

      uint256 tvlInUsd = ((reserves.reserve0 * cvpPrice) + (reserves.reserve1 * ethPrice)) / 1 ether / stableDecimals;

      // apy calculation
      uint256 blocksPerYear = 365 * 7100;
      uint256 cvpPerBlock = mining.cvpPerBlock();
      uint256 poolWeight = ((pool.allocPoint * stableDecimals) / mining.totalAllocPoint());
      uint256 apy = (blocksPerYear * cvpPerBlock * poolWeight * cvpPrice / tvlInUsd) / (10 ** (6 * 4));

      // to get whole apy percents you need to do: apy / 10 ** 4
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
