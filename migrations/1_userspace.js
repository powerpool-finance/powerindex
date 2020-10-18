/* global artifacts, web3 */

module.exports = function(deployer, network, accounts) {
  const isMainnet = network === 'mainnet';
  const isTestnet = network === 'test';
  const e18 = '000000000000000000';

  process["__user__"] = Object.assign(process["__user__"] || {}, {
    isMainnet,
    isTestnet,
    params: {
      cvpPerBlock: isMainnet ? '2659340659340660000' : '2'+e18,
      cvpVestingPeriodInBlocks:  isMainnet ? undefined : '100',
      startBlock: isMainnet ? '10868783' : undefined,
      approveCvpAmount: isMainnet ? undefined : '100000'+e18,
    },

    addresses: {
      admin:     isMainnet ? '0xB258302C3f209491d604165549079680708581Cc' : accounts[0],
      owner:     isMainnet ? '0xb258302c3f209491d604165549079680708581cc' : accounts[0],
      cvp:       isMainnet ? '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1' : undefined,
      reservoir: isMainnet ? '0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E' : undefined,
      lpMining:  isMainnet ? '0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC' : undefined,
    },

    instances: {},
  });

  return process["__user__"];
};
