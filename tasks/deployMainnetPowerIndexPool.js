require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-power-index-pool', 'Deploy PowerIndexPool').setAction(async () => {
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

  const bFactory = await PowerIndexPoolFactory.new(sendOptions);
  const bActions = await PowerIndexPoolActions.new(sendOptions);
  console.log('bFactory', bFactory.address);
  console.log('bActions', bActions.address);
  const poolConfigs = [
    {
      name: 'Power Index Pool Token',
      symbol: 'PIPT',
      tokens: [
        '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', //AAVE
        '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', //YFI
        '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', //SNX
        '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1', //CVP
        '0xc00e94cb662c3520282e6f5717214004a7f26888', //COMP
        '0x0d438f3b5175bebc262bf23753c1e53d03432bde', //wNXM
        '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', //MKR
        '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', //UNI
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
    await pIteration.forEachSeries(poolConfig.tokens, async (tokenAddr, index) => {
      const token = await MockERC20.at(tokenAddr);
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
        token,
        balance: balances[index],
        targetDenorm: ether('6.25'),
        fromTimestamp: '1606769514',
        targetTimestamp: '1607201514'
      })),
      sendOptions,
    );
    const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
    const pool = await PowerIndexPool.at(logNewPool.args.pool);
    console.log('pool.address', pool.address);
    // await pool.setRestrictions(poolRestrictions.address);
    // await poolRestrictions.setTotalRestrictions([pool.address], [ether(20000)]);

    await pool.setController(admin);
  })

  // await pvpV1.transferOwnership(admin);
  // await poolRestrictions.transferOwnership(admin);

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
