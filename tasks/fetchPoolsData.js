usePlugin('@nomiclabs/buidler-truffle5');

const fs = require('fs');

task('fetch-pools-data', 'Fetch pools data').setAction(async () => {
  const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const balancerPoolAddress = '0xb2B9335791346E94245DCd316A9C9ED486E6dD7f';
  const uniswapFactoryAddress = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';

  const BPool = artifacts.require('BPool');
  const MockERC20 = artifacts.require('MockERC20');

  const { web3 } = BPool;

  const pool = await BPool.at(balancerPoolAddress);
  const tokensAddresses = await pool.getCurrentTokens();

  const UniswapV2Factory = artifacts.require('UniswapV2Factory');
  const UniswapV2Pair = artifacts.require('UniswapV2Pair');

  const tokens = [];

  const factory = await UniswapV2Factory.at(uniswapFactoryAddress);
  for (let i = 0; i < tokensAddresses.length; i++) {
    const token = await MockERC20.at(tokensAddresses[i]);
    const pairAddress = await factory.getPair(tokensAddresses[i], wethAddress);
    const pair = await UniswapV2Pair.at(pairAddress);
    const { _reserve0: tokenReserve, _reserve1: ethReserve } = await pair.getReserves();
    const balancerBalance = await pool.getBalance(tokensAddresses[i]);

    tokens.push({
      tokenAddress: tokensAddresses[i],
      tokenSymbol: await token.symbol().catch(() => 'MKR'),
      balancerBalance: parseFloat(web3.utils.fromWei(balancerBalance, 'ether')),
      uniswapPair: {
        address: pairAddress,
        tokenReserve: parseFloat(web3.utils.fromWei(tokenReserve, 'ether')),
        ethReserve: parseFloat(web3.utils.fromWei(ethReserve, 'ether')),
      },
    });
  }

  fs.writeFileSync('./data/poolsData.json', JSON.stringify(tokens, null, ' '));
});

module.exports = {};
