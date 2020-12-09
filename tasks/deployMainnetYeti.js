require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-yeti', 'Deploy YETI').setAction(async () => {
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

  const bFactory = await PowerIndexPoolFactory.at('0x0Ba2e75FE1368d8d517BE1Db5C39ca50a1429441');
  const bActions = await PowerIndexPoolActions.at('0xC258754c7b2f77EB6c5B2C5e87569a9533dA16D2');
  console.log('bFactory', bFactory.address);
  console.log('bActions', bActions.address);
  const poolConfigs = [
    {
      name: 'Yearn Ecosystem Token Index',
      symbol: 'YETI',
      tokens: [
        {address: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', denorm: ether('17.5')}, //YFI
        {address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', denorm: ether('8.5')}, //SUSHI
        {address: '0x2ba592F78dB6436527729929AAf6c908497cB200', denorm: ether('4')}, //CREAM
        {address: '0x8ab7404063ec4dbcfd4598215992dc3f8ec853d7', denorm: ether('4')}, //AKRO
        {address: '0x5D8d9F5b96f4438195BE9b99eee6118Ed4304286', denorm: ether('4')}, //COVER
        {address: '0x1cEB5cB57C4D4E2b2433641b95Dd330A33185A44', denorm: ether('4')}, //KP3R
        {address: '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1', denorm: ether('4')}, //CVP
        {address: '0x429881672B9AE42b8EbA0E26cD9C73711b891Ca5', denorm: ether('4')}, //PICKLE
      ],
      swapFee: 0.002,
      communitySwapFee: 0.001,
      communityJoinFee: 0.001,
      communityExitFee: 0.001,
      communityFeeReceiver: '0xD132973EaEbBd6d7ca7b88e9170f2CCA058de430',
    },
  ];

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
        minWeightPerSecond: ether('0.000005166997354497'),
        maxWeightPerSecond: ether('0.000014467592592593'),
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
        fromTimestamp: '1607532274',
        targetTimestamp: '1607964274'
      })),
      sendOptions,
    );
    const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
    const pool = await PowerIndexPool.at(logNewPool.args.pool);
    console.log('pool.address', pool.address);

    await pool.setController(admin);
  })

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
