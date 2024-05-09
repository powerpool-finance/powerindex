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

interface ILpToken {
  function getBalance(address tokenAddress) external view returns (uint256);
  function totalSupply() external view returns (uint256);
  function allowance(address owner, address spender) external view returns(uint256);
  function balanceOf(address wallet) external view returns (uint256);
  function symbol() external view returns (string memory);
  function decimals() external view returns (uint8);
  function getFinalTokens() external view returns (address[] memory);
  function getNormalizedWeight(address) external view returns (uint256);
  function getSwapFee() external view returns (uint256);
  function getCommunityFee() external view returns (Fees memory);
}

struct EarnListItem {
  address lpToken;
  uint8 poolType;
  uint256 pid;
  uint256 totalSupply;
  uint256 userTotalBalance; // user wallet balance + user mining balance
  PartOfThePool[] tokensDistribution;
}

struct PartOfThePool {
  address tokenAddress;
  string symbol;
  uint256 percent;
}

struct LiquidityTokens {
  address tokenAddress;
  uint256 balance;
  uint8 decimals;
  string symbol;
  uint256 tokenAmountForOneLpMulti;
}

struct Fees {
  uint256 communitySwapFee;
  uint256 communityJoinFee;
  uint256 communityExitFee;
  address communityFeeReceiver;
}

struct RemoveLiquidityData {
  address lpToken;
  uint8 poolType;
  uint256 pid;
  string symbol;
  uint256 balance;
  uint256 allowance;
  Fees fees;
  LiquidityTokens[] tokens;
}

contract DeprecatedBscPoolsLens {
  ILpToken public singlePool;

  constructor(ILpToken _pool) {
    singlePool = _pool;
  }

  function getEarnList(address _user) external view returns (EarnListItem[] memory) {
    EarnListItem[] memory earnPools = new EarnListItem[](1);
    ILpToken pool = singlePool;

    earnPools[0] = EarnListItem({
      lpToken:            address(pool),
      poolType:           0,
      pid:                0,
      totalSupply:        pool.totalSupply(),
      tokensDistribution: new PartOfThePool[](pool.getFinalTokens().length),
      userTotalBalance:   0
    });

    EarnListItem memory earnPool = earnPools[0];

    // User balance
    if (_user != address(0)) {
      earnPool.userTotalBalance = pool.balanceOf(_user);
    }

    // get tokens percents
    address[] memory finalTokens = pool.getFinalTokens();
    for (uint8 j = 0; j < finalTokens.length; j++) {
      earnPool.tokensDistribution[j] = PartOfThePool({
        tokenAddress: finalTokens[j],
        symbol:       ILpToken(finalTokens[j]).symbol(),
        percent:      pool.getNormalizedWeight(finalTokens[j])
      });
    }

    return earnPools;
  }

  function removeLiquidityInfo(address _user, uint256 _pid) external view returns (RemoveLiquidityData memory) {
    ILpToken pool = singlePool;
    LiquidityTokens[] memory tokens = new LiquidityTokens[](pool.getFinalTokens().length);

    for (uint8 i = 0; i < pool.getFinalTokens().length; i++) {
      LiquidityTokens memory token = tokens[i];

      token.tokenAddress = pool.getFinalTokens()[i];
      token.balance = ILpToken(pool.getFinalTokens()[i]).balanceOf(_user);
      token.decimals = ILpToken(pool.getFinalTokens()[i]).decimals();
      token.symbol = ILpToken(pool.getFinalTokens()[i]).symbol();
      token.tokenAmountForOneLpMulti = getMultiTokensOut(token.tokenAddress, token.decimals);
    }

    return RemoveLiquidityData({
      lpToken:    address(pool),
      poolType:   0,
      pid:        _pid,
      symbol:     pool.symbol(),
      balance:    pool.balanceOf(_user),
      allowance:  pool.allowance(_user, address(pool)),
      fees:       pool.getCommunityFee(),
      tokens:     tokens
    });
  }

  function getMultiTokensOut(address _tokenAddress, uint8 _decimals) internal view returns (uint256) {
    ILpToken pool = singlePool;
    uint256 totalSupply = pool.totalSupply();
    uint256 reserve = pool.getBalance(_tokenAddress);

    return (((1 ether * 10**18) / totalSupply) * (reserve * 10**(18 - _decimals))) / 10**18;
  }
}
