require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-yla', 'Deploy YLA').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, callContract} = require('../test/helpers');

  const PowerIndexPoolFactory = await artifacts.require('PowerIndexPoolFactory');
  const PowerIndexPoolActions = await artifacts.require('PowerIndexPoolActions');
  const PowerIndexPool = await artifacts.require('PowerIndexPool');
  const MockERC20 = await artifacts.require('MockERC20');

  const { web3 } = PowerIndexPoolFactory;
  const { toWei } = web3.utils;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const admin = '0xb258302c3f209491d604165549079680708581cc';

  const bFactory = await PowerIndexPoolFactory.at('0x967D77f1fBb5fD1846Ce156bAeD3AAf0B13020D1');
  const bActions = await PowerIndexPoolActions.at('0xc282f9c362ca10b54d26eb87eb25a7b7d52a7109');
  const poolConfig = {
    name: 'Yearn Lazy Ape Index',
    symbol: 'YLA',
    tokens: [
      {address: '0x629c759D1E83eFbF63d84eb3868B564d9521C129', denorm: ether('2.091694919')},
      {address: '0x9cA85572E6A3EbF24dEDd195623F188735A5179f', denorm: ether('9.165624933')},
      {address: '0xcC7E70A958917cCe67B4B87a8C30E6297451aE98', denorm: ether('4.214260959')},
      {address: '0x5dbcF33D8c2E976c6b560249878e6F1491Bca25c', denorm: ether('6.76184064')},
      {address: '0x2994529C0652D127b7842094103715ec5299bBed', denorm: ether('2.766578549')},
    ],
    swapFee: 0.002,
    communitySwapFee: 0.001,
    communityJoinFee: 0.001,
    communityExitFee: 0.001,
    communityFeeReceiver: '0xD132973EaEbBd6d7ca7b88e9170f2CCA058de430',
  };

  let poolAddress;
  const balances = [];
  await pIteration.forEachSeries(poolConfig.tokens, async (t, index) => {
    const token = await MockERC20.at(t.address);
    balances[index] = (await callContract(token, 'balanceOf', [deployer])).toString(10);
    console.log('approve', token.address, balances[index]);
    await token.approve(bActions.address, balances[index], sendOptions);
  });

  const start = Math.round(new Date().getTime() / 1000) + 60 * 10;

  const res = await bActions.create(
    bFactory.address,
    poolConfig.name,
    poolConfig.symbol,
    {
      minWeightPerSecond: ether('0'),
      maxWeightPerSecond: ether('1'),
      swapFee: ether(poolConfig.swapFee),
      communitySwapFee: ether(poolConfig.communitySwapFee),
      communityJoinFee: ether(poolConfig.communityJoinFee),
      communityExitFee: ether(poolConfig.communityExitFee),
      communityFeeReceiver: poolConfig.communityFeeReceiver,
      finalize: true,
    },
    poolConfig.tokens.map((token, index) => ({
      token: token.address,
      balance: balances[index],
      targetDenorm: token.denorm,
      fromTimestamp: start,
      targetTimestamp: start + 60
    })),
    sendOptions,
  );
  const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
  const pool = await PowerIndexPool.at(logNewPool.args.pool);
  console.log('pool.address', pool.address);

  await pool.setController(admin);
  poolAddress = pool.address;

  // await pvpV1.transferOwnership(admin);
  // await poolRestrictions.transferOwnership(admin);
  if (network.name !== 'mainnetfork') {
    return;
  }
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';

  await impersonateAccount(ethers, admin);
  const MockPowerIndexPoolV2 = await artifacts.require('MockPowerIndexPoolV2');
  const ProxyAdmin = await artifacts.require('ProxyAdmin');

  const newImpl = await MockPowerIndexPoolV2.new();

  const proxyAdmin = await ProxyAdmin.at(proxyAdminAddr);
  await proxyAdmin.upgrade(poolAddress, newImpl.address, {from: admin});

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});
