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
  function cvp() external view returns (address);
}

interface QuoterV2 {
  struct QuoteExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint24 fee;
    uint160 sqrtPriceLimitX96;
  }

  function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
  external
  returns (
    uint256 amountOut,
    uint160 sqrtPriceX96After,
    uint32 initializedTicksCrossed,
    uint256 gasEstimate
  );
}

interface IUniswapV2Router {
  function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

contract VestedLpMiningLens is Ownable {
  IVestedLpMining public mining;

  address public usdtAddress;
  address public uniswapV3Quoter;
  uint8 public stableTokenDecimals;
  address public uniswapRouter;

  mapping(address => address) public tokenSwapThroughToken;
  mapping(address => bool) public tokenUniV3;
  mapping(address => address) public piptSwapByPool;

  constructor(
    IVestedLpMining _mining,
    address _usdtAddress,
    address _uniswapV3Quoter,
    address _uniswapRouter,
    uint8 _stableTokenDecimals
  ) public {
    mining = _mining;
    usdtAddress = _usdtAddress;
    uniswapRouter = _uniswapRouter;
    uniswapV3Quoter = _uniswapV3Quoter;
    stableTokenDecimals = _stableTokenDecimals;
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

  function getLpTokenPrice(address lpToken, uint256 _decimals) public returns (uint256 result) {
    if (piptSwapByPool[lpToken] == address(0)) {
      address[] memory path;
      address throughToken = tokenSwapThroughToken[lpToken];
      if (throughToken != address(0)) {
        path = new address[](3);
        path[0] = lpToken;
        path[1] = throughToken;
        path[2] = usdtAddress;
      } else {
        path = new address[](2);
        path[0] = lpToken;
        path[1] = usdtAddress;
      }

      uint256 oneUnit = 10 ** _decimals;
      uint256 _amountIn = 10 ** (_decimals - stableTokenDecimals);
      if (tokenUniV3[lpToken]) {
        QuoterV2.QuoteExactInputSingleParams memory params = QuoterV2.QuoteExactInputSingleParams(lpToken, usdtAddress, oneUnit, 3000, 0);
        try QuoterV2(uniswapV3Quoter).quoteExactInputSingle(params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate) {
          result = _amountIn * amountOut / oneUnit;
        } catch {
        }
      } else {
        try IUniswapV2Router(uniswapRouter).getAmountsOut(oneUnit, path) returns (uint256[] memory amountsOut) {
          result = _amountIn * amountsOut[amountsOut.length - 1] / oneUnit;
        } catch {
        }
      }
    } else {
      result = IPiptSwap(piptSwapByPool[lpToken]).calcNeedErc20ToPoolOut(usdtAddress, 1000000000000000000, 20000000000000000);
    }
    return 0;
  }

  // set through tokens for certain pools
  function setThroughTokens(address[] memory poolAddresses, address[] memory throughTokenAddress) external onlyOwner {
    for (uint256 i = 0; i < poolAddresses.length; i++) {
      tokenSwapThroughToken[poolAddresses[i]] = throughTokenAddress[i];
    }
  }

  // set array tokens as uniswap v3 tokens
  function setUniswapV3Tokens(address[] memory tokens, bool isV3) external onlyOwner {
    for (uint256 i = 0; i < tokens.length; i++) {
      tokenUniV3[tokens[i]] = isV3;
    }
  }

  // Here owner is manually sets piptSwap addresses for each pull. If pool not in that mapping, then use instantUniswap
  function setPiptSwapByPool(address[] memory poolAddresses, address[] memory piptSwapAddress) external onlyOwner {
    for (uint256 i = 0; i < poolAddresses.length; i++) {
      piptSwapByPool[poolAddresses[i]] = piptSwapAddress[i];
    }
  }
}
