const LPMining = artifacts.require('LPMining');
const MockCvp = artifacts.require('MockCvp');
const Reservoir = artifacts.require('Reservoir');
const VestedLPMining = artifacts.require('VestedLPMining');
const proxies = require('./helpers/proxies');
const getUserspace = require('./1_userspace');

module.exports = function (deployer, network, accounts) {
  deployer.then(async () => {
    const userNs = process['__user__'] || getUserspace(deployer, network, accounts);
    if (userNs.isTestnet) return;

    const reservoir = userNs.isMainnet
      ? await Reservoir.at(userNs.addresses.reservoir)
      : await deployer.deploy(Reservoir);

    if (!userNs.isMainnet) {
      const { approveCvpAmount, cvpPerBlock, cvpVestingPeriodInBlocks } = userNs.params;
      const { owner } = userNs.addresses;

      const mockCvp = process.env.CVP ? await MockCvp.at(process.env.CVP) : await deployer.deploy(MockCvp);
      await mockCvp.transfer(reservoir.address, approveCvpAmount);

      const startBlock = `${await web3.eth.getBlockNumber()}`;
      const lpMining = await deployer.deploy(LPMining, mockCvp.address, reservoir.address, cvpPerBlock, startBlock);
      await reservoir.setApprove(mockCvp.address, lpMining.address, approveCvpAmount);

      const proxyAdmin = await proxies(web3).Admin.new({ from: owner });
      const vLpMiningImpl = await deployer.deploy(VestedLPMining);
      const vLpMiningProxy = await proxies(web3).VestedLpMiningProxy(
        vLpMiningImpl.address,
        proxyAdmin.address,
        [mockCvp.address, reservoir.address, cvpPerBlock, startBlock, cvpVestingPeriodInBlocks],
        { from: owner },
      );
      await reservoir.setApprove(mockCvp.address, vLpMiningProxy.address, approveCvpAmount);

      userNs.instances.vLpMining = await VestedLPMining.at(vLpMiningProxy.address);
      userNs.instances.proxyAdmin = proxyAdmin;
      userNs.instances.reservoir = reservoir;
      userNs.instances.mockCvp = mockCvp;
    }
  });
};
