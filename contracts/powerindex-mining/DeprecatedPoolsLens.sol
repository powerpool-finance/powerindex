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

  function poolLength() external view returns(uint);
  function reservoir() external view returns(address);
}

interface ILpToken {
  function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);
  function totalSupply() external view returns (uint256);
  function balanceOf(address wallet) external view returns (uint256);
  function symbol() external view returns (string memory);
}

interface ERC20 {
  function balanceOf(address wallet) external view returns (uint256);
  function allowance(address owner, address spender) external view returns(uint256);
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
  uint256 lpAtMiningAmount;
  uint256 pendedCvp;
  uint256 vestableCvp;
  uint256 lockedCvp;
  bool isBoosted;
}

struct miningUserDataStruct {
  uint32 lastUpdateBlock;
  uint32 vestingBlock;
  uint96 pendedCvp;
  uint96 cvpAdjust;
  uint256 lptAmount;
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

  //
  function getFarmingList(address _user) public view returns (FarmingListItem[] memory) {
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
        lpAtMiningAmount: 0,
        pendedCvp:        0,
        vestableCvp:      0,
        lockedCvp:        0,
        isBoosted:        false
      });

      FarmingListItem memory farmingPool = farmingPools[i];

      // User total lp and balance
      if (_user != address(0)) {
        miningUserDataStruct memory data = mining.users(i + 6, _user);
        farmingPool.lpAtMiningAmount = data.lptAmount;
        farmingPool.pendedCvp = data.pendedCvp;
        farmingPool.vestableCvp = mining.vestableCvp(i + 6, _user);
        farmingPool.lockedCvp = farmingPool.pendedCvp - farmingPool.vestableCvp;
      }

      // Check if pool is boostable
      (uint256 lpBoostRate,,,,) = mining.poolBoostByLp(i + 6);
      if (lpBoostRate > 0) {
        farmingPool.isBoosted = true;
      }
    }

    return farmingPools;
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
