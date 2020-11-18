usePlugin('@nomiclabs/buidler-truffle5');

const fs = require('fs');

task('fetch-pools-data', 'Fetch pools data').setAction(async () => {
  const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const balancerPoolAddress = '0xb2B9335791346E94245DCd316A9C9ED486E6dD7f';
  const uniswapFactoryAddress = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';

  const BPool = artifacts.require('BPool');
  const MockERC20 = artifacts.require('MockERC20');

  const pool = await BPool.at(balancerPoolAddress);
  const tokensAddresses = await callContract(pool, 'getCurrentTokens');

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
    const { _reserve0: tokenReserve, _reserve1: ethReserve } = await callContract(pair, 'getReserves');
    const balancerBalance = await callContract(pool, 'getBalance', [tokensAddresses[i]]).catch(() => '0');

    tokens.push({
      tokenAddress: tokensAddresses[i],
      tokenSymbol: await callContract(token, 'symbol').catch(() => 'MKR'),
      tokenDecimals: await callContract(token, 'decimals').catch(() => '18'),
      balancerBalance,
      uniswapPair: {
        address: pairAddress,
        tokenReserve,
        ethReserve,
      },
    });
  }

  fs.writeFileSync('./data/poolsData.json', JSON.stringify(tokens, null, ' '));
});

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}

module.exports = {};
