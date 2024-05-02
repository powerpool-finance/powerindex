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
  function poolBoostByLp(uint256 pId) external view returns (uint256, uint256, uint32, uint256, uint256);
  function usersPoolBoost(uint256 pId, address user) external view returns(uint256 balance, uint32 lastUpdateBlock);

  function poolLength() external view returns(uint);
  function reservoir() external view returns(address);
}

interface ILpToken {
  function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);
  function token0() external view returns (address);
  function token1() external view returns (address);
  function totalSupply() external view returns (uint256);
  function balanceOf(address wallet) external view returns (uint256);
  function symbol() external view returns (string memory);
  function factory() external view returns (address);
}

interface ERC20 {
  function balanceOf(address wallet) external view returns (uint256);
  function allowance(address owner, address spender) external view returns(uint256);
  function decimals() external view returns (uint8);
}

struct Pool {
  address lpToken; // address of the LP token contract
  bool votesEnabled; // if the pool is enabled to write votes
  uint8 poolType; // pool type (1 - Uniswap, 2 - Balancer, 3 - custom, 4 - sushi)
  uint32 allocPoint; // points assigned to the pool, which affect CVPs distribution between pools
  uint32 lastUpdateBlock; // latest block when the pool params which follow was updated
  uint256 accCvpPerLpt; // accumulated distributed CVPs per one deposited LP token, times 1e12
}

struct FarmingListItem {
  address lpToken;
  uint8 poolType;
  uint256 pid;
  uint256 lpAtMiningAmount;
  uint256 vestableCvp;
  bool isBoosted;
}

struct FarmingDetail {
  address lpToken;
  uint8 poolType;
  uint256 pid;
  uint256 lpMiningBalance;
  uint256 lpTotalSupply;
  uint256 vestableCvp;
  uint256 lpTokenUserStakedAtMining;
  uint256 boostedAmount;
  bool isReservoirEnough;
  bool isSushi;
  bool isBalancer;
}

struct miningUserDataStruct {
  uint32 lastUpdateBlock;
  uint32 vestingBlock;
  uint96 pendedCvp;
  uint96 cvpAdjust;
  uint256 lptAmount;
}

struct tokenInfo {
  address tokenAddress;
  string tokenSymbol;
  uint256 reserves;
  uint8 decimals;
  uint256 tokenAmountPerLPToken;
}

struct tokenRemove {
  address lpToken;
  uint8 poolType;
  uint256 pid;
  uint256 lpTotalSupply;
  uint256 balance;
  uint256 allowance;
  tokenInfo token1;
  tokenInfo token2;
}

contract DeprecatedPoolsLens {
  IVestedLpMining public mining;
  IUniswapV2Router public uniRouter;

  address public stableAddress;
  address immutable public wethAddress;
  address immutable public cvpAddress;

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
    cvpAddress = _cvpAddress;
  }

  function getFarmingList(address _user) external view returns (FarmingListItem[] memory) {
    Pool[] memory pools = new Pool[](8);
    pools[0] = mining.pools(6);
    pools[1] = mining.pools(7);
    pools[2] = mining.pools(8);
    pools[3] = mining.pools(9);
    pools[4] = mining.pools(10);
    pools[5] = mining.pools(11);
    pools[6] = mining.pools(12);
    pools[7] = mining.pools(13);
//    lpBoostRate

    FarmingListItem[] memory farmingPools = new FarmingListItem[](8);

    for (uint256 i = 0; i < 8; i++) {
      Pool memory pool = pools[i];

      farmingPools[i] = FarmingListItem({
        lpToken:          pool.lpToken,
        poolType:         pool.poolType,
        pid:              i + 6,
        lpAtMiningAmount: 0,
        vestableCvp:      0,
        isBoosted:        false
      });

      FarmingListItem memory farmingPool = farmingPools[i];

      // User total lp and balance
      if (_user != address(0)) {
        uint256 vestableCvp = mining.vestableCvp(farmingPool.pid, _user);
        farmingPool.lpAtMiningAmount = mining.users(farmingPool.pid, _user).lptAmount;
        farmingPool.vestableCvp = vestableCvp;
      }

      // Check if pool is boostable
      (uint256 lpBoostRate,,,,) = mining.poolBoostByLp(farmingPool.pid);
      if (lpBoostRate > 0) {
        farmingPool.isBoosted = true;
      }
    }

    return farmingPools;
  }

  function getFarmingDetail(address _user, uint256 _pid) external view returns (FarmingDetail memory) {
    Pool memory pool = mining.pools(_pid);

    // User total lp and balance
    uint256 lpTokenUserStaked;
    uint256 vestableCvp;
    uint boostAmount;
    if (_user != address(0)) {
      lpTokenUserStaked = mining.users(_pid, _user).lptAmount;
      vestableCvp = mining.vestableCvp(_pid, _user);
      (boostAmount,) = mining.usersPoolBoost(_pid, _user);
    }

    // Check if can claim cvp
    bool isReservoirEnough = vestableCvp <= ERC20(cvpAddress).balanceOf(mining.reservoir()) || vestableCvp <= ERC20(cvpAddress).allowance(mining.reservoir(), address(mining));

    // check if 3rd party pool involved (so later it can be unwrapped to one of PowerPool pool)
    bool isSushi = _pid == 11 || _pid == 12;
    bool isBalancer = _pid == 7 || _pid == 8;

    return FarmingDetail({
      lpToken:                   pool.lpToken,
      poolType:                  pool.poolType,
      pid:                       _pid,
      lpMiningBalance:           ILpToken(pool.lpToken).balanceOf(address(mining)),
      lpTotalSupply:             ILpToken(pool.lpToken).totalSupply(),
      vestableCvp:               vestableCvp,
      lpTokenUserStakedAtMining: lpTokenUserStaked,
      boostedAmount:             boostAmount,
      isReservoirEnough:         isReservoirEnough,
      isSushi:                   isSushi,
      isBalancer:                isBalancer
    });
  }


  function getSushiSecondaryLiquidityRemoveInfo(address _user, uint _pid) external view returns (tokenRemove memory) {
    Pool memory pool = mining.pools(_pid);
    bool isSushi = pool.poolType == 4;

    address routerContract;
    if (isSushi) { // sushi
      routerContract = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    } else {       // balancer
      routerContract = pool.lpToken;
    }

    (uint112 reserve0, uint112 reserve1,) = ILpToken(pool.lpToken).getReserves();

    uint8 token1Decimals = ERC20(ILpToken(pool.lpToken).token0()).decimals();
    uint8 token2Decimals = ERC20(ILpToken(pool.lpToken).token1()).decimals();
    uint256 lpTotalSupply = ILpToken(pool.lpToken).totalSupply();

    return tokenRemove({
      lpToken:                   pool.lpToken,
      poolType:                  pool.poolType,
      pid:                       _pid,
      lpTotalSupply:             lpTotalSupply,
      balance:                   ERC20(pool.lpToken).balanceOf(_user),
      allowance:                 ERC20(pool.lpToken).allowance(_user, routerContract),
      token1: tokenInfo({
        tokenAddress: ILpToken(pool.lpToken).token0(),
        tokenSymbol: ILpToken(ILpToken(pool.lpToken).token0()).symbol(),
        decimals: token1Decimals,
        reserves: reserve0,
        tokenAmountPerLPToken:  (((1 ether * 10**18) / lpTotalSupply) * (reserve0 * 10**(18 - token1Decimals))) / 10**18
      }),
      token2: tokenInfo({
        tokenAddress: ILpToken(pool.lpToken).token1(),
        tokenSymbol: ILpToken(ILpToken(pool.lpToken).token1()).symbol(),
        decimals: token2Decimals,
        reserves: reserve1,
        tokenAmountPerLPToken:  (((1 ether * 10**18) / lpTotalSupply) * (reserve1 * 10**(18 - token2Decimals))) / 10**18
      })
    });
  }

  // TODO: Remove automatic 0 pool fetch and use TokenBAddress
  // Accepts amount of token A from pair and returns corresponding amount of token B from pair. (You can switch both tokens)
  function getTokenBAmount(uint256 tokenAAmountWei, address tokenAAddress, address) external view returns(uint256) {
    Pool memory pool = mining.pools(0);
    (uint112 reserve0, uint112 reserve1,) = ILpToken(pool.lpToken).getReserves();
    uint256 reserveA;
    uint256 reserveB;

    if (tokenAAddress == cvpAddress) {
      reserveA = reserve0;
      reserveB = reserve1;
    } else if (tokenAAddress == wethAddress) {
      reserveB = reserve0;
      reserveA = reserve1;
    }
    return uniRouter.quote(tokenAAmountWei, reserveA, reserveB);
  }
}
