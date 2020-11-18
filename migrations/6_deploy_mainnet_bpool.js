const MockERC20 = artifacts.require('MockERC20');
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const WETH = artifacts.require('WETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
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
    if (userNs.isTestnet || !userNs.isMainnet) return;

    const { admin } = userNs.addresses;
    if (!web3.utils.isAddress(admin)) throw new Error('Invalid admin address');

    const bFactory = await deployer.deploy(BFactory);
    const bActions = await deployer.deploy(BActions);
    await deployer.deploy(ExchangeProxy, '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
    const poolRestrictions = await deployer.deploy(PoolRestrictions);
    const pvpV1 = await deployer.deploy(PermanentVotingPowerV1);

    const poolConfigs = [
      {
        name: 'Power Index Pool Token',
        symbol: 'PIPT',
        tokens: [
          '0x80fB784B7eD66730e8b1DBd9820aFD29931aab03', //LEND
          '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', //YFI
          '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', //SNX
          '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1', //CVP
          '0xc00e94cb662c3520282e6f5717214004a7f26888', //COMP
          '0x0d438f3b5175bebc262bf23753c1e53d03432bde', //wNXM
          '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', //MKR
          '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', //UNI
        ],
        denorms: [6.25, 6.25, 6.25, 6.25, 6.25, 6.25, 6.25, 6.25],
        swapFee: 0.002,
        communitySwapFee: 0.001,
        communityJoinFee: 0.001,
        communityExitFee: 0.001,
        communityFeeReceiver: pvpV1.address,
      },
    ];

    // Run one by one
    await poolConfigs.reduce(
      async (promiseChain, poolConfig) =>
        promiseChain.then(async () => {
          const balances = [];
          let index = 0;
          // Again, one by one
          await poolConfig.tokens.reduce(
            async (innerChain, tokenAddr) =>
              innerChain.then(async () => {
                const token = await MockERC20.at(tokenAddr);
                balances[index] = (await token.balanceOf(accounts[0])).toString(10);
                await token.approve(bActions.address, balances[index++]);
              }),
            Promise.resolve(),
          );

          const res = await bActions.create(
            bFactory.address,
            poolConfig.name,
            poolConfig.symbol,
            poolConfig.tokens,
            balances,
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

          await pool.setController(admin);
        }),
      Promise.resolve(),
    );

    await pvpV1.transferOwnership(admin);
    await poolRestrictions.transferOwnership(admin);
  });
};

function ether(amount) {
  return toWei(amount.toString(), 'ether');
}
