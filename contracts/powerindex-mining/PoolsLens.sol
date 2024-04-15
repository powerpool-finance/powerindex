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

interface IUniswapV2Router {
  function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
  function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) external view returns (uint256 amountB);
}

interface IVestedLpMining {
  function pools(uint256 index) external view returns (Pool calldata);
  function users(uint256 poolId, address userAddress) external view returns (miningUserDataStruct calldata);
  function cvpPerBlock() external view returns (uint96);
  function totalAllocPoint() external view returns (uint256);
  function vestableCvp(uint256 pId, address user) external view returns (uint256);

  function poolLength() external view returns(uint);
  function reservoir() external view returns(address);
}

interface ILpToken {
  function getReserves() external view returns (ReservesStruct calldata);
  function totalSupply() external view returns (uint256);
  function balanceOf(address wallet) external view returns (uint256);
}

interface ERC20 {
  function balanceOf(address wallet) external view returns (uint256);
  function allowance(address owner, address spender) external view returns(uint256);
}

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
  uint256 poolWeightSzabo;
  uint96 cvpPerBlock;
}

struct FarmingData {
  LpBasicData lpData;
  uint256 lpTotalSupplyWei;
  uint256 miningLpBalanceWei;
  uint256 mainTokenPerPoolWei;
  uint256 mainTokenPerPoolTokenWei;
  bool isReservoirEnough;
}

struct PoolForLiquidityManagers {
  address tokenAddress;
  uint256 balanceWei;
  uint256 allowanceWei;
  uint256 tokenAmountPerLPToken;
  uint256 poolBalanceOfThisToken;
  uint256 tokenPriceSzabo;
  string symbol;
}

struct PoolAtMiningForLiquidityManagers {
  uint256 LpAtMiningAmountWei;
  uint256 cvpAtMiningMiningWei;
  uint256 ethAtMiningMiningWei;
}

struct LiquidityManagers {
  uint256 lpTotalSupply;
  TokenPrices tokenPrices;
  uint256 amountCvpInSingleEth;
  uint256 amountEthInSingleCvp;
  TokenBalances allowanceInfo;
  PoolForLiquidityManagers[] tokens;
  miningUserDataExtendedStruct userInfo;
  PoolAtMiningForLiquidityManagers miningData;
}

struct MiningManager {
  uint256 apyFinney;
  TokenPrices tokenPrices;
  TokenBalances allowanceInfo;
  miningUserDataExtendedStruct userInfo;
  PoolAtMiningForLiquidityManagers userMiningData;
  bool isReservoirEnough;
}

struct ReservesStruct {
  uint112 reserve0;
  uint112 reserve1;
  uint32 blockTimestampLast;
}

struct TokenPrices {
  uint256 cvpPriceSzabo;
  uint256 ethPriceSzabo;
  uint256 lpTokenPriceFinney;
}

struct miningUserDataStruct {
  uint32 lastUpdateBlock;
  uint32 vestingBlock;
  uint96 pendedCvp;
  uint96 cvpAdjust;
  uint256 lptAmount;
}

struct miningUserDataExtendedStruct {
  uint96 pendedCvp;
  uint256 vestableCvp;
  uint256 lockedCvp;
  uint256 lpAtMiningAmount;
}

struct TokenBalances {
  uint256 EthUserBalance;
  uint256 CvpUserBalance;
  uint256 CvpRouterAllowance;
  uint256 LpUserBalance;
  uint256 LpMiningBalance;
  uint256 LpMiningAllowance;
  TokenPrices prices;
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

  // get basic data for active pool (0 index pool). apy, tvl, tokens prices, basic pool data and user specific data
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
      userInfo.lpAtMiningAmount = data.lptAmount;
      userInfo.pendedCvp = data.pendedCvp;
      userInfo.vestableCvp = mining.vestableCvp(0, user);
      userInfo.lockedCvp = userInfo.pendedCvp - userInfo.vestableCvp;
    }

    return LpBasicData({
      tvlUsd:      tvlInUsd,
      apyFinney:   apy / 10,
      tokenPrices: TokenPrices({
        cvpPriceSzabo:      cvpPrice,
        ethPriceSzabo:      ethPrice,
        lpTokenPriceFinney: (tvlInUsd * 10 ** 21) / ILpToken(pool.lpToken).totalSupply()
      }),
      poolData: PoolData({
        lpTokenAddress:  pool.lpToken,
        poolWeightSzabo: poolWeight,
        cvpPerBlock:     mining.cvpPerBlock()
      }),
      userInfo: userInfo
    });
  }

  // Aggregate information for farming page
  function getFarmingData(address user) external view returns(FarmingData memory) {
    LpBasicData memory lpData = getBasicPoolData(user);
    uint lpTotalSupply = ILpToken(lpData.poolData.lpTokenAddress).totalSupply();
    uint256 miningLpBalance = ILpToken(lpData.poolData.lpTokenAddress).balanceOf(address(mining));
    uint256 mainTokenPerPool = (lpData.poolData.cvpPerBlock * lpData.poolData.poolWeightSzabo) / 10 ** 6;
    uint256 mainTokenPerPoolToken = miningLpBalance != 0 ? (mainTokenPerPool * 10 ** 18) / miningLpBalance : 0;

    // Checking if reservoir is capable to return possible claim
    bool isReservoirEnough = false;
    uint256 vestableCvp = lpData.userInfo.vestableCvp;
    if (vestableCvp <= ERC20(cvpAddress).balanceOf(mining.reservoir()) || vestableCvp <= ERC20(cvpAddress).allowance(mining.reservoir(), address(mining))) {
      isReservoirEnough = true;
    }

    return FarmingData({
      lpData:                   lpData,
      lpTotalSupplyWei:         lpTotalSupply,
      miningLpBalanceWei:       miningLpBalance,
      mainTokenPerPoolWei:      mainTokenPerPool,
      mainTokenPerPoolTokenWei: mainTokenPerPoolToken,
      isReservoirEnough:        isReservoirEnough
    });
  }

  // this function returns data used for liquidity add and remove
  function getLiquidityManager(address user) public view returns(LiquidityManagers memory) {
    LpBasicData memory lpData = getBasicPoolData(user);
    TokenBalances memory tokensInfo = getTokensInfo(user);

    uint lpTotalSupply = ILpToken(lpData.poolData.lpTokenAddress).totalSupply();
    ReservesStruct memory reserves = ILpToken(lpData.poolData.lpTokenAddress).getReserves();

    // setting tokens array
    PoolForLiquidityManagers[] memory tokens = new PoolForLiquidityManagers[](2);
    tokens[0] = PoolForLiquidityManagers({
      tokenAddress:           cvpAddress,
      balanceWei:             tokensInfo.CvpUserBalance,
      allowanceWei:           tokensInfo.CvpRouterAllowance,
      tokenAmountPerLPToken:  (((1 ether * 10**18) / lpTotalSupply) * reserves.reserve0) / 10**18,
      poolBalanceOfThisToken: reserves.reserve0,
      tokenPriceSzabo:        tokensInfo.prices.cvpPriceSzabo,
      symbol:                 'CVP'
    });
    tokens[1] = PoolForLiquidityManagers({
      tokenAddress:           wethAddress,
      balanceWei:             tokensInfo.EthUserBalance,
      allowanceWei:           1000000000000000000000000,
      tokenAmountPerLPToken:  (((1 ether * 10**18) / lpTotalSupply) * reserves.reserve1) / 10**18,
      poolBalanceOfThisToken: reserves.reserve1,
      tokenPriceSzabo:        tokensInfo.prices.ethPriceSzabo,
      symbol:                 'ETH'
    });

    return LiquidityManagers({
      lpTotalSupply:        lpTotalSupply,
      tokenPrices:          lpData.tokenPrices,
      amountCvpInSingleEth: getAmountsOut(wethAddress, cvpAddress),
      amountEthInSingleCvp: getAmountsOut(cvpAddress, wethAddress),
      allowanceInfo:        tokensInfo,
      tokens:               tokens,
      userInfo:             lpData.userInfo,
      miningData: PoolAtMiningForLiquidityManagers({
        LpAtMiningAmountWei:  lpData.userInfo.lpAtMiningAmount,
        cvpAtMiningMiningWei: (((lpData.userInfo.lpAtMiningAmount * 10**18) / lpTotalSupply) * reserves.reserve0) / 10**18,
        ethAtMiningMiningWei: (((lpData.userInfo.lpAtMiningAmount * 10**18) / lpTotalSupply) * reserves.reserve1) / 10**18
      })
    });
  }

  // this function returns data used for mining contract operations (add and remove lpTokens from mining)
  function getMiningManager(address user) external view returns(MiningManager memory) {
    LpBasicData memory lpData = getBasicPoolData(user);
    LiquidityManagers memory liquidityData = getLiquidityManager(user);

    // Checking if reservoir is capable to return possible claim
    bool isReservoirEnough = false;
    uint256 vestableCvp = lpData.userInfo.vestableCvp;
    if (vestableCvp <= ERC20(cvpAddress).balanceOf(mining.reservoir()) || vestableCvp <= ERC20(cvpAddress).allowance(mining.reservoir(), address(mining))) {
      isReservoirEnough = true;
    }

    return MiningManager({
      apyFinney:           lpData.apyFinney,
      tokenPrices:         liquidityData.tokenPrices,
      allowanceInfo:       liquidityData.allowanceInfo,
      userInfo:            liquidityData.userInfo,
      userMiningData:      liquidityData.miningData,
      isReservoirEnough:   isReservoirEnough
    });
  }

  // Accepts amount of token A from pair and returns corresponding amount of token B from pair. (You can switch both tokens)
  function getTokenBAmount(uint256 tokenAAmountWei, address tokenAAddress, address tokenBAddress) external view returns(uint256) {
    Pool memory pool = mining.pools(0);
    ReservesStruct memory reserves = ILpToken(pool.lpToken).getReserves();
    uint256 reserveA;
    uint256 reserveB;

    if (tokenAAddress == cvpAddress) {
      reserveA = reserves.reserve0;
      reserveB = reserves.reserve1;
    } else if (tokenAAddress == wethAddress) {
      reserveB = reserves.reserve0;
      reserveA = reserves.reserve1;
    }
    return uniRouter.quote(tokenAAmountWei, reserveA, reserveB);
  }

  // get all token prices in usd
  function getPrices() public view returns(TokenPrices memory) {
    Pool memory pool = mining.pools(0);
    uint256 stableDecimals = 10 ** 6;

    // token prices
    ReservesStruct memory reserves = ILpToken(pool.lpToken).getReserves();
    uint256 cvpPrice = getAmountsOut(cvpAddress, stableAddress);
    uint256 ethPrice = getAmountsOut(wethAddress, stableAddress);

    // tvl calc
    uint256 tvlInUsd = ((reserves.reserve0 * cvpPrice) + (reserves.reserve1 * ethPrice)) / 1 ether / stableDecimals;

    return TokenPrices({
      cvpPriceSzabo:      cvpPrice,
      ethPriceSzabo:      ethPrice,
      lpTokenPriceFinney: (tvlInUsd * 10 ** 21) / ILpToken(pool.lpToken).totalSupply()
    });
  }

  // Returns balances and allowances of all 3 tokens (cvp, eth, lp) and prices for them
  function getTokensInfo(address owner) public view returns(TokenBalances memory) {
    Pool memory pool = mining.pools(0);
    if (owner != address(0)) {
      return TokenBalances({
        EthUserBalance:     owner.balance,
        CvpUserBalance:     ERC20(cvpAddress).balanceOf(owner),
        CvpRouterAllowance: ERC20(cvpAddress).allowance(owner, address(uniRouter)),
        LpUserBalance:      ERC20(pool.lpToken).balanceOf(owner),
        LpMiningBalance:    ERC20(pool.lpToken).balanceOf(address(mining)),
        LpMiningAllowance:  ERC20(pool.lpToken).allowance(owner, address(mining)),
        prices:             getPrices()
      });
    } else {
      return TokenBalances({
        EthUserBalance:     0,
        CvpUserBalance:     0,
        CvpRouterAllowance: 0,
        LpUserBalance:      0,
        LpMiningBalance:    ERC20(pool.lpToken).balanceOf(address(mining)),
        LpMiningAllowance:  0,
        prices:             getPrices()
      });
    }
  }
}
