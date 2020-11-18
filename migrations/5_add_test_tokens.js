const MockERC20 = artifacts.require('MockERC20');
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const WETH = artifacts.require('WETH');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const BPool = artifacts.require('BPool');
const PermanentVotingPowerV1 = artifacts.require('PermanentVotingPowerV1');
const getUserspace = require('./1_userspace');

WETH.numberFormat = 'String';

const { web3 } = MockERC20;
const { toWei } = web3.utils;

module.exports = function (deployer, network, accounts) {
  deployer.then(async () => {
    const userNs = process['__user__'] || getUserspace(deployer, network, accounts);
    if (userNs.isTestnet || userNs.isMainnet) return;

    const bFactory = await BFactory.deployed();
    const bActions = await BActions.deployed();
    const poolRestrictions = await deployer.deploy(PoolRestrictions);
    const pvpV1 = await deployer.deploy(PermanentVotingPowerV1);

    const lendToken = await deployer.deploy(MockERC20, 'LEND', 'LEND', ether(10e6));
    const compToken = await deployer.deploy(MockERC20, 'COMP', 'COMP', ether(10e6));
    const yfiToken = await deployer.deploy(MockERC20, 'YFI', 'YFI', ether(10e6));
    const umaToken = await deployer.deploy(MockERC20, 'UMA', 'UMA', ether(10e6));
    const mkrToken = await deployer.deploy(MockERC20, 'MKR', 'MKR', ether(10e6));
    const uniToken = await deployer.deploy(MockERC20, 'UNI', 'UNI', ether(10e6));
    const crvToken = await deployer.deploy(MockERC20, 'CRV', 'CRV', ether(10e6));
    const snxToken = await deployer.deploy(MockERC20, 'SNX', 'SNX', ether(10e6));

    const pools = [
      {
        name: 'Test Index Token',
        symbol: 'TIT',
        tokens: [
          lendToken.address,
          yfiToken.address,
          compToken.address,
          umaToken.address,
          mkrToken.address,
          uniToken.address,
          crvToken.address,
          snxToken.address,
        ],
        balances: [50, 10, 100, 200, 150, 75, 125, 60],
        denorms: [6.25, 6.25, 6.25, 6.25, 6.25, 6.25, 6.25, 6.25],
        swapFee: 0.002,
        communitySwapFee: 0.001,
        communityJoinFee: 0.001,
        communityExitFee: 0.001,
        communityFeeReceiver: pvpV1.address,
        miningVotes: false,
      },
    ];

    // Run one by one
    await pools.reduce(
      async (promiseChain, poolConfig) =>
        promiseChain.then(async () => {
          // Again, one by one
          let index = 0;
          await poolConfig.tokens.reduce(
            async (innerChain, tokenAddr) =>
              innerChain.then(async () => {
                const pairToken = await MockERC20.at(tokenAddr);
                await pairToken.approve(bActions.address, ether(poolConfig.balances[index++]));
              }),
            Promise.resolve(),
          );

          const res = await bActions.create(
            bFactory.address,
            poolConfig.name,
            poolConfig.symbol,
            poolConfig.tokens,
            poolConfig.balances.map(b => ether(b)),
            poolConfig.denorms.map(d => ether(d)),
            [
              ether(poolConfig.swapFee),
              ether(poolConfig.communitySwapFee),
              ether(poolConfig.communityJoinFee),
              ether(poolConfig.communityExitFee),
            ],
            poolConfig.communityFeeReceiver,
            true,
          );

          const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
          const pool = await BPool.at(logNewPool.args.pool);
          console.log('pool.address', pool.address);
          await pool.setRestrictions(poolRestrictions.address);
          await poolRestrictions.setTotalRestrictions([pool.address], [ether(20000)]);
        }),
      Promise.resolve(),
    );

    // await lpMining.transferOwnership(deployer);
    // await reservoir.transferOwnership(deployer);
  });
};

function ether(amount) {
  return toWei(amount.toString(), 'ether');
}
