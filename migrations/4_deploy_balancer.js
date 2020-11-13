const BFactory = artifacts.require('BFactory');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const BActions = artifacts.require('BActions');
const WETH = artifacts.require('WETH');
const getUserspace = require('./1_userspace');

module.exports = function (deployer, network, accounts) {
  deployer.then(async () => {
    const userNs = process['__user__'] || getUserspace(deployer, network, accounts);
    if (userNs.isTestnet || userNs.isMainnet) return;

    let wethAddress;
    if (userNs.isMainnet) {
      wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    } else {
      const weth = await deployer.deploy(WETH);
      wethAddress = weth.address;
    }

    await deployer.deploy(BFactory);
    await deployer.deploy(BActions);
    await deployer.deploy(ExchangeProxy, wethAddress);
  });
};
