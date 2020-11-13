const getUserspace = require('./1_userspace');

module.exports = function (deployer, network, accounts) {
  deployer.then(async () => {
    const userNs = process['__user__'] || getUserspace(deployer, network, accounts);
    if (userNs.isTestnet || !userNs.isMainnet) return;

    const { admin } = userNs.addresses;
    if (!web3.utils.isAddress(admin)) throw new Error('Invalid admin address');

    const lpMining = userNs.instances.lpMining;
    const reservoir = userNs.instances.reservoir;

    const testLpTokens = [
      {
        name: 'Uniswap',
        address: '0x12d4444f96c644385d8ab355f6ddf801315b6254',
        poolType: '1',
      },
      {
        name: 'Balancer 1',
        address: '0xbd7a8f648262b6cb29d38b575df9f27e6cdecde1',
        poolType: '2',
      },
      {
        name: 'Balancer 2',
        address: '0x10d9b57f769fbb355cdc2f3c076a65a288ddc78e',
        poolType: '2',
      },
      {
        name: 'Balancer 3',
        address: '0x1af23b311f203844108137d6ee399109e4981401',
        poolType: '2',
      },
    ];

    // Run one by one
    await testLpTokens.reduce(
      async (promiseChain, token) =>
        promiseChain.then(async () => {
          console.log('add', token.name);
          await lpMining.add('10', token.address, token.poolType, true, true);
          console.log('done', token.name);
        }),
      Promise.resolve(),
    );

    await lpMining.transferOwnership(admin);
    await reservoir.transferOwnership(admin);
  });
};
