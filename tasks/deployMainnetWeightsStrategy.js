require('@nomiclabs/hardhat-truffle5');

task('deploy-mainnet-weights-strategy', 'Deploy Mainnet Weights Strategy').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, gwei, fromEther, ethUsed, deployProxied} = require('../test/helpers');
  const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
  const PowerIndexPool = artifacts.require('PowerIndexPool');
  const MCapWeightStrategy = artifacts.require('MCapWeightStrategy');
  const PowerPoke = await artifacts.require('PowerPoke');

  const { web3 } = PowerIndexPoolController;
  const { toWei } = web3.utils;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const weightsChangeDuration = 24 * 60 * 60;
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const admin = '0xb258302c3f209491d604165549079680708581cc';
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const oracleAddress = '0x50f8D7f4db16AA926497993F020364f739EDb988';
  const poolAddress = '0xfa2562da1bba7b954f26c74725df51fb62646313';
  const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';

  const weightStrategy =  await deployProxied(
    MCapWeightStrategy,
    [],
    [oracleAddress, powerPokeAddress, weightsChangeDuration],
    {
      proxyAdmin: proxyAdminAddr,
      // proxyAdminOwner: admin,
      implementation: ''
    }
  );
  console.log('weightStrategyProxy.address', weightStrategy.address);
  console.log('weightStrategyImplementation.address', weightStrategy.initialImplementation.address);

  const controller = await PowerIndexPoolController.new(poolAddress, zeroAddress, zeroAddress, weightStrategy.address);
  console.log('controller.address', controller.address);
  await weightStrategy.addPool(poolAddress, controller.address, zeroAddress);

  const excludeBalances = [
    {token: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', excludeTokenBalances: ['0x25F2226B597E8F9514B3F68F00f494cF4f286491', '0x317625234562B1526Ea2FaC4030Ea499C5291de4']}, // AAVE
    {token: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', excludeTokenBalances: ['0xFEB4acf3df3cDEA7399794D0869ef76A6EfAff52']}, // YFI
    {token: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', excludeTokenBalances: ['0x971e78e0c92392a4e39099835cf7e6ab535b2227', '0xda4ef8520b1a57d7d63f1e249606d1a459698876']}, // SNX
  ];

  await weightStrategy.setExcludeTokenBalancesList(excludeBalances);

  await weightStrategy.transferOwnership(admin);

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
  await powerPoke.addClient(weightStrategy.address, admin, true, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, {from: admin});
  await powerPoke.setMinimalDeposit(weightStrategy.address, MIN_SLASHING_DEPOSIT, {from: admin});
  await powerPoke.setBonusPlan(weightStrategy.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {from: admin});
  await powerPoke.setFixedCompensations(weightStrategy.address, 200000, 60000, {from: admin});

  const cvp = await PowerIndexPool.at('0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1');
  await cvp.approve(powerPoke.address, ether(10000), {from: admin});
  await powerPoke.addCredit(weightStrategy.address, ether(10000), {from: admin});

  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
  await impersonateAccount(ethers, pokerReporter);
  const testWallet = ethers.Wallet.createRandom();
  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
    {to: testWallet.address, compensateInETH: true},
  );
  const res = await weightStrategy.pokeFromReporter('1', [poolAddress], powerPokeOpts, {from: pokerReporter});

  console.log('powerPoke rewards', fromEther(await powerPoke.rewards('1')));
  console.log('ETH used', await ethUsed(web3, res.receipt));
  console.log('ETH compensation', fromEther(await web3.eth.getBalance(testWallet.address)));

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});
