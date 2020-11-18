// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../interfaces/IUniswapV2Pair.sol";
import "../interfaces/IUniswapV2Factory.sol";

contract Migrator {
  address public lpMining;
  address public oldFactory;
  IUniswapV2Factory public factory;
  uint256 public notBeforeBlock;
  uint256 public desiredLiquidity = uint256(-1);

  constructor(
    address _lpMining,
    address _oldFactory,
    IUniswapV2Factory _factory,
    uint256 _notBeforeBlock
  ) public {
    lpMining = _lpMining;
    oldFactory = _oldFactory;
    factory = _factory;
    notBeforeBlock = _notBeforeBlock;
  }

  function migrate(IUniswapV2Pair orig, uint8 poolType) public returns (IUniswapV2Pair) {
    require(poolType == 1, "Only Uniswap poolType supported");
    require(msg.sender == lpMining, "not from lpMining");
    require(block.number >= notBeforeBlock, "too early to migrate");
    require(orig.factory() == oldFactory, "not from old factory");
    address token0 = orig.token0();
    address token1 = orig.token1();
    IUniswapV2Pair pair = IUniswapV2Pair(factory.getPair(token0, token1));
    if (pair == IUniswapV2Pair(address(0))) {
      pair = IUniswapV2Pair(factory.createPair(token0, token1));
    }
    uint256 lp = orig.balanceOf(msg.sender);
    if (lp == 0) return pair;
    desiredLiquidity = lp;
    orig.transferFrom(msg.sender, address(orig), lp);
    orig.burn(address(pair));
    pair.mint(msg.sender);
    desiredLiquidity = uint256(-1);
    return pair;
  }
}
