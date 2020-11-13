const contract = require('@truffle/contract');
const ozProxy = require('@openzeppelin/upgrades/build/contracts/AdminUpgradeabilityProxy.json');
const ozAdmin = require('@openzeppelin/upgrades/build/contracts/ProxyAdmin.json');

/** @dev
 * The Solc version (^0.5.0) the '@openzeppelin/upgrades' package (v.2.8.0) requires
 * is incompatible with the version this project applies.
 * Therefore compiled binaries rather than the source code used.
 */
module.exports = web3 => {
  const Proxy = contract({ abi: ozProxy.abi, bytecode: ozProxy.bytecode });
  Proxy.setProvider(web3.currentProvider);

  const Admin = contract({ abi: ozAdmin.abi, bytecode: ozAdmin.bytecode });
  Admin.setProvider(web3.currentProvider);

  const VestedLpMiningProxy = async (logicAddr, adminAddr, argsArray, txOptions = { gas: '5000000' }) =>
    await Proxy.new(
      logicAddr,
      adminAddr,
      web3.eth.abi.encodeFunctionCall(
        {
          name: 'initialize',
          type: 'function',
          inputs: [
            { name: '_cvp', type: 'address' },
            { name: '_reservoir', type: 'address' },
            { name: '_cvpPerBlock', type: 'uint256' },
            { name: '_startBlock', type: 'uint256' },
            { name: '_cvpVestingPeriodInBlocks', type: 'uint256' },
          ],
        },
        argsArray,
      ),
      txOptions,
    );

  return {
    Admin,
    Proxy,
    VestedLpMiningProxy,
  };
};
