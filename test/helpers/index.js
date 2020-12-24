const { ether: rEther } = require('@openzeppelin/test-helpers');
const TruffleContract = require('@nomiclabs/truffle-contract');
const template = artifacts.require('Migrations');
const { promisify } = require('util');
const { web3 } = template;
const BigNumber = require('bignumber.js')
const fs = require('fs')

const AdminUpgradeabilityProxyArtifact = require('@openzeppelin/upgrades-core/artifacts/AdminUpgradeabilityProxy.json');
const ProxyAdminArtifact = require('@openzeppelin/upgrades-core/artifacts/ProxyAdmin.json');
const AdminUpgradeabilityProxy = TruffleContract(AdminUpgradeabilityProxyArtifact);
const ProxyAdmin = TruffleContract(ProxyAdminArtifact);

AdminUpgradeabilityProxy.setProvider(template.currentProvider);
AdminUpgradeabilityProxy.defaults(template.class_defaults);
ProxyAdmin.setProvider(template.currentProvider);
ProxyAdmin.defaults(template.class_defaults);

let proxyAdmin;

/**
 * Rewinds ganache by n blocks
 * @param {number} n
 * @returns {Promise<void>}
 */
async function advanceBlocks(n) {
  // eslint-disable-next-line no-undef
  const send = promisify(web3.currentProvider.send).bind(web3.currentProvider);
  const requests = [];
  for (let i = 0; i < n; i++) {
    requests.push(send({
      jsonrpc: '2.0',
      method: 'evm_mine',
      id: `${new Date().getTime()}-${Math.random()}`,
    }));
  }
  await Promise.all(requests);
}

/**
 * Deploys a proxied contract
 *
 * @param contract Truffle Contract
 * @param {string[]} args
 * @param {object} opts
 * @param {string} opts.deployer
 * @param {string} opts.initializer
 * @param {string} opts.proxyAdminOwner
 * @returns {Promise<any>}
 */
async function deployProxied(
  contract,
  args = [],
  opts = {}
) {
  const impl = await contract.new();
  const adminContract = await createOrGetProxyAdmin(opts.proxyAdminOwner);
  const data = getInitializerData(impl, args, opts.initializer);
  const proxy = await AdminUpgradeabilityProxy.new(impl.address, adminContract.address, data);
  const instance = await contract.at(proxy.address);

  instance.proxy = proxy;
  instance.initialImplementation = impl;

  return instance;
}

/**
 * Creates and returns ProxyAdmin contract
 * @param {string} proxyOwner
 * @returns {Promise<TruffleContract>}
 */
async function createOrGetProxyAdmin(proxyOwner) {
  if (!proxyAdmin) {
    proxyAdmin = await ProxyAdmin.new();
    await proxyAdmin.transferOwnership(proxyOwner);
  }
  return proxyAdmin;
}


function getInitializerData(impl, args, initializer) {
  const allowNoInitialization = initializer === undefined && args.length === 0;
  initializer = initializer || 'initialize';

  if (initializer in impl.contract.methods) {
    return impl.contract.methods[initializer](...args).encodeABI();
  } else if (allowNoInitialization) {
    return '0x';
  } else {
    throw new Error(`Contract ${impl.name} does not have a function \`${initializer}\``);
  }
}

/**
 * Fetches logs of a given contract for a given tx,
 * since Truffle provides logs for a calle contract only.
 * @param {TruffleContract} contract
 * @param {object} receipt
 * @param {string} receipt.tx
 * @returns {Promise<{object}>}
 */
async function fetchLogs(contract, receipt) {
  const res = await web3.eth.getTransactionReceipt(receipt.tx);
  return contract.decodeLogs(res.logs);
}

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

/**
 * Splits a payload into a signature and calldata.
 * @param {string} payload
 * @returns Object
 */
function splitPayload(payload) {
  return {
    signature: payload.substring(0, 10),
    calldata: `0x${payload.substring(10)}`
  }
}

function ether(value) {
  return rEther(value.toString()).toString(10);
}

async function deployAndSaveArgs(Contract, args) {
  const newInstance = await Contract.new.apply(Contract, args);
  fs.writeFileSync(
    `./tmp/${newInstance.address}-args.js`,
    `module.exports = ${JSON.stringify(args, null, 2)}`
  );
  return newInstance;
}

async function impersonateAccount(ethers, adminAddress) {
  await ethers.provider.getSigner().sendTransaction({
    to: adminAddress,
    value: '0x' + new BigNumber(ether('1')).toString(16)
  })

  await ethers.provider.send('hardhat_impersonateAccount', [adminAddress]);
}

async function forkContractUpgrade(ethers, adminAddress, proxyAdminAddress, proxyAddress, implAddress) {
  const iface = new ethers.utils.Interface(['function upgrade(address proxy, address impl)']);

  await impersonateAccount(ethers, adminAddress);

  await ethers.provider.getSigner(adminAddress).sendTransaction({
    to: proxyAdminAddress,
    data: iface.encodeFunctionData('upgrade', [proxyAddress, implAddress])
  })
}

async function increaseTime(ethers, time) {
  return ethers.provider.send('evm_increaseTime', [time]);
}

module.exports = {
  deployProxied,
  createOrGetProxyAdmin,
  artifactFromBytecode,
  toEvmBytes32,
  advanceBlocks,
  splitPayload,
  fetchLogs,
  ether,
  forkContractUpgrade,
  deployAndSaveArgs,
  increaseTime,
  impersonateAccount
}
