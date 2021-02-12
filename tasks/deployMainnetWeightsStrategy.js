require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-mainnet-weights-strategy', 'Deploy YETI').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, callContract} = require('../test/helpers');
  const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
  const PowerIndexPool = artifacts.require('PowerIndexPool');
  const MCapWeightStrategy = artifacts.require('MCapWeightStrategy');
  const MockERC20 = await artifacts.require('MockERC20');
  const PowerPoke = await artifacts.require('PowerPoke');

  const { web3 } = PowerIndexPoolController;
  const { toWei } = web3.utils;

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

  const weightStrategyImpl = await MCapWeightStrategy.new(sendOptions);
  console.log('weightStrategyImpl.address', weightStrategyImpl.address);
  const weightStrategyProxy = await proxies.VestedLpMiningProxy(
    weightStrategyImpl.address,
    proxyAdminAddr,
    [oracleAddress, powerPokeAddress],
    sendOptions,
  );

  const controller = await PowerIndexPoolController.new(poolAddress, zeroAddress, zeroAddress, weightStrategyProxy.address);
  await weightStrategyProxy.addPool(poolAddress, controller.address);

  const excludeBalances = [
    {token: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', excludeTokenBalances: ['0xda4ef8520b1a57d7d63f1e249606d1a459698876']}, // SNX
    // {token: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', excludeTokenBalances: ['0x8798249c2e607446efb7ad49ec89dd1865ff4272']}, // SUSHI
    // {token: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', excludeTokenBalances: ['0x8798249c2e607446efb7ad49ec89dd1865ff4272']}, // SUSHI
  ];

  await weightStrategyProxy.setExcludeTokenBalancesList(excludeBalances);

  await weightStrategyProxy.transferOwnership(admin);

  //TODO: calculate maxWPS
  if (network.name !== 'mainnetfork') {
    return;
  }
  const BONUS_NUMERATOR = '7610350076';
  const BONUS_DENUMERATOR = '10000000000000000';
  const MIN_REPORT_INTERVAL = 60 * 60 * 24 * 14;
  const MAX_REPORT_INTERVAL = MIN_REPORT_INTERVAL + 60 * 60;
  const MAX_GAS_PRICE = gwei(500);
  const PER_GAS = '10000';
  const MIN_SLASHING_DEPOSIT = ether(40);

  await impersonateAccount(ethers, admin);

  const pool = await PowerIndexPool.at(poolAddress);
  await pool.setController(controller.address, {from: admin});

  const powerPoke = await PowerPoke.at(powerPokeAddress);
  await powerPoke.addClient(oracle.address, deployer, true, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, {from: admin});
  await powerPoke.setMinimalDeposit(oracle.address, MIN_SLASHING_DEPOSIT, {from: admin});
  await powerPoke.setBonusPlan(oracle.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {from: admin});

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
