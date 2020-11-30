const TruffleContract = require('@nomiclabs/truffle-contract');
const template = artifacts.require('Migrations');

const { web3 } = template;

/**
 * Creates a truffle contract from bytecode and abi
 * @param name of the contract along with path
 * @returns TruffleContract
 */
function artifactFromBytecode(name) {
  const data = require(`../../assets/${name}.json`);
  const contract = TruffleContract(data);
  contract.setProvider(web3.currentProvider);
  contract.defaults(template.class_defaults);
  contract.numberFormat = 'String';
  return contract;
}

function toEvmBytes32(bytes32) {
  return web3.utils.padRight(bytes32, 64);
}

module.exports = {
  artifactFromBytecode,
  toEvmBytes32
}
