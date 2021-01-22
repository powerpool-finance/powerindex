require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-assy', 'Deploy ASSY').setAction(async (__, {ethers, network}) => {
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
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const proxyFactoryAddr = '0x3C8C3c0A1Ee8296e41a0B735a7a58c179A6D595E';
  const impl = await PowerIndexPool.new();

  const bFactory = await PowerIndexPoolFactory.new(proxyFactoryAddr, impl.address, proxyAdminAddr, sendOptions);
  const bActions = await PowerIndexPoolActions.new(sendOptions);
  console.log('bFactory', bFactory.address);
  console.log('bActions', bActions.address);
  const poolConfigs = [
    {
      name: 'ASSY Index',
      symbol: 'ASSY',
      tokens: [
        {address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', denorm: ether('15')},   //AAVE
        {address: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', denorm: ether('12.5')}, //SNX
        {address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', denorm: ether('7.5')},  //SUSHI
        {address: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', denorm: ether('15')},   //YFI
      ],
      swapFee: 0.002,
      communitySwapFee: 0.001,
      communityJoinFee: 0.001,
      communityExitFee: 0.001,
      communityFeeReceiver: '0xD132973EaEbBd6d7ca7b88e9170f2CCA058de430',
    },
  ];

  let poolAddress;
  await pIteration.forEachSeries(poolConfigs, async poolConfig => {
    const balances = [];
    await pIteration.forEachSeries(poolConfig.tokens, async (t, index) => {
      const token = await MockERC20.at(t.address);
      balances[index] = (await callContract(token, 'balanceOf', [deployer])).toString(10);
      console.log('approve', token.address, balances[index]);
      await token.approve(bActions.address, balances[index], sendOptions);
    });

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
        fromTimestamp: '1611314033',
        targetTimestamp: '1611314333'
      })),
      sendOptions,
    );
    const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
    const pool = await PowerIndexPool.at(logNewPool.args.pool);
    console.log('pool.address', pool.address);
    // await pool.setRestrictions(poolRestrictions.address);
    // await poolRestrictions.setTotalRestrictions([pool.address], [ether(20000)]);

    await pool.setController(admin);
    poolAddress = pool.address;
  })

  // await pvpV1.transferOwnership(admin);
  // await poolRestrictions.transferOwnership(admin);
  if (network.name !== 'mainnetfork') {
    return;
  }
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
