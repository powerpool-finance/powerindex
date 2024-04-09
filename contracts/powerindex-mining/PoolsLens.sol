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

struct LpBasicData {
  uint256 tvlUsd;
  uint256 apyFinney;
  TokenPrices tokenPrices;
  PoolData poolData;
  miningUserDataExtendedStruct userInfo;
}

struct PoolData {
  address lpTokenAddress;
  uint256 poolWeight;
  uint96 cvpPerBlock;
}

struct FarmingData {
  LpBasicData lpData;
  uint256 lpTotalSupply;
  uint256 miningLpBalance;
  uint256 mainTokenPerPool;
  uint256 mainTokenPerPoolToken;
}

struct PositionData {
  uint256 lptAmount;
  uint256 lpTotalSupply;
  TokenPrices tokenPrices;
  uint256 userCvpAmountWei;
  uint256 userEthAmountWei;
  uint256 amountCvpInSingleEth;
  uint256 amountEthInSingleCvp;
  miningUserDataExtendedStruct userInfo;
}

struct ReservesStruct {
  uint112 reserve0;
  uint112 reserve1;
  uint32 blockTimestampLast;
}

struct miningUserDataStruct {
  uint32 lastUpdateBlock;
  uint32 vestingBlock;
  uint96 pendedCvp;
  uint96 cvpAdjust;
  uint256 lptAmount;
}

struct TokenPrices {
  uint256 cvpPriceSzabo;
  uint256 ethPriceSzabo;
  uint256 lpTokenPriceFinney;
}

struct miningUserDataExtendedStruct {
  uint96 pendedCvp;
  uint256 vestableCvp;
  uint256 lockedCvp;
  uint256 lptAmount;
}

interface IUniswapV2Router {
  function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

interface IVestedLpMining {
  function pools(uint256 index) external view returns (Pool calldata);
  function users(uint256 poolId, address userAddress) external view returns (miningUserDataStruct calldata);
  function cvpPerBlock() external view returns (uint96);
  function totalAllocPoint() external view returns (uint256);
  function vestableCvp(uint256 pId, address user) external view returns (uint256);

  function poolLength() external view returns(uint);
}

interface ILpToken {
  function getReserves() external view returns (ReservesStruct calldata);
  function totalSupply() external view returns (uint256);
  function balanceOf(address wallet) external view returns (uint256);
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

    // Set cvp to eth out path
    address[] memory cvpToEth = new address[](2);
    cvpToEth[0] = _cvpAddress;
    cvpToEth[1] = _wethAddress;
    setExchangePath(cvpToEth);

    // Set eth to cvp out path
    address[] memory ethToCvp = new address[](2);
    ethToCvp[0] = _wethAddress;
    ethToCvp[1] = _cvpAddress;
    setExchangePath(ethToCvp);
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

  // get basic data for active pool (0 index pool)
  function getBasicPoolData(address user) public view returns (LpBasicData memory) {
    Pool memory pool = mining.pools(0);
    miningUserDataExtendedStruct memory userInfo;
    uint256 stableDecimals = 10 ** 6;

    // token prices
    ReservesStruct memory reserves = ILpToken(pool.lpToken).getReserves();
    uint256 cvpPrice = getAmountsOut(cvpAddress, stableAddress);
    uint256 ethPrice = getAmountsOut(wethAddress, stableAddress);

    // tvl calc
    uint256 tvlInUsd = ((reserves.reserve0 * cvpPrice) + (reserves.reserve1 * ethPrice)) / 1 ether / stableDecimals;

    // apy calculation
    uint256 poolWeight = ((pool.allocPoint * stableDecimals) / mining.totalAllocPoint());
    uint256 apy = ((365 * 7100) * mining.cvpPerBlock() * poolWeight * cvpPrice / tvlInUsd) / (10 ** (6 * 4));

    // user specific data fetch
    if (user != address(0)) {
      miningUserDataStruct memory data = mining.users(0, user);
      userInfo.lptAmount = data.lptAmount;
      userInfo.pendedCvp = data.pendedCvp;
      userInfo.vestableCvp = mining.vestableCvp(0, user);
      userInfo.lockedCvp = userInfo.pendedCvp - userInfo.vestableCvp;
    }

    return LpBasicData({
      tvlUsd: tvlInUsd,
      apyFinney: apy / 10,
      tokenPrices: TokenPrices({
        cvpPriceSzabo: cvpPrice,
        ethPriceSzabo: ethPrice,
        lpTokenPriceFinney: (tvlInUsd * 10 ** 21) / ILpToken(pool.lpToken).totalSupply()
      }),
      poolData: PoolData({
        lpTokenAddress: pool.lpToken,
        poolWeight: poolWeight,
        cvpPerBlock: mining.cvpPerBlock()
      }),
      userInfo: userInfo
    });
  }

  function getFarmingData(address user) public view returns(FarmingData memory) {
    LpBasicData memory lpData = getBasicPoolData(user);
    uint lpTotalSupply = ILpToken(lpData.poolData.lpTokenAddress).totalSupply();
    uint256 miningLpBalance = ILpToken(lpData.poolData.lpTokenAddress).balanceOf(user);

    uint256 mainTokenPerPool = lpData.poolData.cvpPerBlock * lpData.poolData.poolWeight;
    uint256 mainTokenPerPoolToken = miningLpBalance != 0 ? mainTokenPerPool / miningLpBalance : 0;

    return FarmingData({
      lpData: lpData,
      lpTotalSupply: lpTotalSupply,
      miningLpBalance: miningLpBalance,
      mainTokenPerPool: mainTokenPerPool,
      mainTokenPerPoolToken: mainTokenPerPoolToken
    });
  }

  function getUserPosition(address user) external view returns(PositionData memory) {
    LpBasicData memory lpData = getBasicPoolData(user);

    uint lpTotalSupply = ILpToken(lpData.poolData.lpTokenAddress).totalSupply();
    ReservesStruct memory reserves = ILpToken(lpData.poolData.lpTokenAddress).getReserves();

    return PositionData({
      lptAmount: lpData.userInfo.lptAmount,
      lpTotalSupply: lpTotalSupply,
      tokenPrices: lpData.tokenPrices,
      userCvpAmountWei: (((lpData.userInfo.lptAmount * 10**18) / lpTotalSupply) * reserves.reserve0) / 10**18,
      userEthAmountWei: (((lpData.userInfo.lptAmount * 10**18) / lpTotalSupply) * reserves.reserve1) / 10**18,
      userInfo: lpData.userInfo,
      amountCvpInSingleEth: getAmountsOut(wethAddress, cvpAddress),
      amountEthInSingleCvp: getAmountsOut(cvpAddress, wethAddress)
    });
  }
}
