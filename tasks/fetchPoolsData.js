require('@nomiclabs/hardhat-truffle5');

const fs = require('fs');

task('fetch-pools-data', 'Fetch pools data').setAction(async () => {
  const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const balancerPoolAddress = '0x26607ac599266b21d13c7acf7942c7701a8b699c';
  const uniswapFactoryAddress = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';
  const oracleAddress = '0x019e14DA4538ae1BF0BCd8608ab8595c6c6181FB';

  const BPool = artifacts.require('BPool');
  const MockOracle = artifacts.require('MockOracle');
  const MockERC20 = artifacts.require('MockERC20');

  const oracle = await MockOracle.at(oracleAddress);
  const pool = await BPool.at(balancerPoolAddress);
  const tokensAddresses = await callContract(pool, 'getCurrentTokens', [], 'array');

  tokensAddresses.push('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'); // USDC
  tokensAddresses.push('0x6b175474e89094c44da98b954eedeac495271d0f'); // DAI
  tokensAddresses.push('0xdac17f958d2ee523a2206206994597c13d831ec7'); // USDT
  tokensAddresses.push('0x4Fabb145d64652a948d72533023f6E7A623C7C53'); // BUSD

  const UniswapV2Factory = artifacts.require('UniswapV2Factory');
  const UniswapV2Pair = artifacts.require('UniswapV2Pair');

  const tokens = [];

  const factory = await UniswapV2Factory.at(uniswapFactoryAddress);
  for (let i = 0; i < tokensAddresses.length; i++) {
    const token = await MockERC20.at(tokensAddresses[i]);
    const pairAddress = await callContract(factory, 'getPair', [tokensAddresses[i], wethAddress]);
    const pair = await UniswapV2Pair.at(pairAddress);
    const { _reserve0, _reserve1 } = await callContract(pair, 'getReserves');
    const token0 = await callContract(pair, 'token0');
    let ethReserve, tokenReserve;
    let isReverse = token0.toLowerCase() === wethAddress.toLowerCase();
    if (isReverse) {
      ethReserve = _reserve0;
      tokenReserve = _reserve1;
    } else {
      ethReserve = _reserve1;
      tokenReserve = _reserve0;
    }
    const balancerBalance = await callContract(pool, 'getBalance', [tokensAddresses[i]]).catch(() => '0');

    tokens.push({
      tokenAddress: tokensAddresses[i],
      tokenSymbol: await callContract(token, 'symbol').catch(() => 'MKR'),
      tokenDecimals: await callContract(token, 'decimals').catch(() => '18'),
      totalSupply: await callContract(token, 'totalSupply'),
      balancerBalance,
      oraclePrice: await callContract(oracle, 'assetPrices', [tokensAddresses[i]]).catch(e => '0'),
      uniswapPair: {
        address: pairAddress,
        tokenReserve,
        ethReserve,
        isReverse,
      },
    });
  }

  fs.writeFileSync('./data/poolsData.json', JSON.stringify(tokens, null, ' '));
});

async function callContract(contract, method, args = [], type = null) {
  console.log(method, args);
  let result = await contract.contract.methods[method].apply(contract.contract, args).call();
  if (type === 'array') {
    result = [].concat(result);
  }
  return result;
}

module.exports = {};
