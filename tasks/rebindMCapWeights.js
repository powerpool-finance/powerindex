require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('rebind-mcap-weights', 'Rebind MCap weights').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, forkContractUpgrade} = require('../test/helpers');
  const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
  const PowerIndexPool = artifacts.require('PowerIndexPool');
  const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
  const MCapWeightStrategyRebinder = artifacts.require('MCapWeightStrategyRebinder');
  const MockERC20 = await artifacts.require('MockERC20');
  const PowerPoke = await artifacts.require('PowerPoke');

  const { web3 } = PowerIndexPoolController;
  const { toWei, fromWei } = web3.utils;

  const proxies = require('../migrations/helpers/proxies')(web3);

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const admin = '0xb258302c3f209491d604165549079680708581cc';
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const oracleAddress = '0x50f8D7f4db16AA926497993F020364f739EDb988';
  const poolAddress = '0xfa2562da1bba7b954f26c74725df51fb62646313';
  const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';

  const rebinder = await MCapWeightStrategyRebinder.new(oracleAddress, sendOptions);

  const excludeBalances = [
    {token: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', excludeTokenBalances: ['0x25F2226B597E8F9514B3F68F00f494cF4f286491', '0x317625234562B1526Ea2FaC4030Ea499C5291de4']}, // AAVE
    {token: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', excludeTokenBalances: ['0xFEB4acf3df3cDEA7399794D0869ef76A6EfAff52']}, // YFI
    {token: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', excludeTokenBalances: ['0x971e78e0c92392a4e39099835cf7e6ab535b2227', '0xda4ef8520b1a57d7d63f1e249606d1a459698876']}, // SNX
  ];

  await rebinder.setExcludeTokenBalancesList(excludeBalances);

  await rebinder.transferOwnership(admin);

  if (network.name !== 'mainnetfork') {
    return;
  }
  await forkContractUpgrade(ethers, admin, proxyAdminAddr, poolAddress, (await PowerIndexPool.new()).address);

  const uRouter = await UniswapV2Router02.at('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
  await uRouter.swapExactETHForTokens(ether(50000), ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f'], rebinder.address, Math.round(new Date().getTime() / 1000) + 100, {
    value: ether(10000)
  });
  await uRouter.swapExactETHForTokens(ether(5000), ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'], rebinder.address, Math.round(new Date().getTime() / 1000) + 100, {
    value: ether(10000)
  });
  await uRouter.swapExactETHForTokens(ether(20000), ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2'], rebinder.address, Math.round(new Date().getTime() / 1000) + 100, {
    value: ether(10000)
  });
  const pool = await PowerIndexPool.at(poolAddress);

  const tokens = await callContract(pool, 'getCurrentTokens');

  console.log('\nbefore:')
  await pIteration.forEachSeries(tokens, async (t, i) => {
    const token = await MockERC20.at(t);
    console.log(await callContract(token, 'symbol'), 'balance', fromEther(await callContract(pool, 'getBalance', [t])), 'weight', fromEther(await callContract(pool, 'getNormalizedWeight', [t])), 'price', fromEther(await callContract(pool, 'getSpotPrice', [t, i === 0 ? tokens[tokens.length - 1] : tokens[i - 1]])));
  });
  await pool.setController(rebinder.address, {from: admin});
  await rebinder.runRebind(poolAddress, admin, '2', {from: admin});

  console.log('\nafter:')
  await pIteration.forEachSeries(tokens, async (t, i) => {
    const token = await MockERC20.at(t);
    console.log(await callContract(token, 'symbol'), 'balance', fromEther(await callContract(pool, 'getBalance', [t])), 'weight', fromEther(await callContract(pool, 'getNormalizedWeight', [t])), 'price', fromEther(await callContract(pool, 'getSpotPrice', [t, i === 0 ? tokens[tokens.length - 1] : tokens[i - 1]])));
  });
  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
  function fromEther(amount) {
    return fromWei(amount.toString(), 'ether');
  }
});

function callContract(contract, method, args = []) {
  // console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
