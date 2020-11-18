// SPDX-License-Identifier: MIT

pragma solidity =0.6.12;

import "./uniswapv2/UniswapV2Pair.sol";
import "./uniswapv2/UniswapV2Factory.sol";

contract MockUniswapV2Factory is UniswapV2Factory {
  constructor(address _feeToSetter) public UniswapV2Factory(_feeToSetter) {}

  function createPairMock(address tokenA, address tokenB) external returns (address pair) {
    require(tokenA != tokenB, "UniswapV2: IDENTICAL_ADDRESSES");
    (address token0, address token1) = (tokenA, tokenB);
    require(token0 != address(0), "UniswapV2: ZERO_ADDRESS");
    require(getPair[token0][token1] == address(0), "UniswapV2: PAIR_EXISTS"); // single check is sufficient
    bytes memory bytecode = type(UniswapV2Pair).creationCode;
    bytes32 salt = keccak256(abi.encodePacked(token0, token1));
    assembly {
      pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
    }
    UniswapV2Pair(pair).initialize(token0, token1);
    getPair[token0][token1] = pair;
    getPair[token1][token0] = pair; // populate mapping in the reverse direction
    allPairs.push(pair);
    emit PairCreated(token0, token1, pair, allPairs.length);
  }
}
