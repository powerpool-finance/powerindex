const { ether: rEther } = require('@openzeppelin/test-helpers');
const TruffleContract = require('@nomiclabs/truffle-contract');
const template = artifacts.require('Migrations');
const { promisify } = require('util');
const { assert } = require('chai');
const { buildBasicRouterArgs } = require('./builders');
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

const getCounter = (n => () => n++)(1);

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
    requests.push(
      send({
        jsonrpc: '2.0',
        method: 'evm_mine',
        id: `${new Date().getTime()}-${Math.random()}`,
      }),
    );
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
async function deployProxied(contract, args = [], opts = {}) {
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

async function expectExactRevert(promise, expectedMsg) {
  try {
    await promise;
  } catch (error) {
    const coverageTailoredError = `Returned error: VM Exception while processing transaction: revert ${expectedMsg}`;
    if (error.message !== expectedMsg && error.message !== coverageTailoredError) {
      assert.equal(
        error.message,
        `VM Exception while processing transaction: revert ${expectedMsg}`,
        'Wrong kind of exception received',
      );
    }
    return;
  }

  assert.fail('Expected an exception but none was received');
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
    calldata: `0x${payload.substring(10)}`,
  };
}

function ether(value) {
  return rEther(value.toString()).toString(10);
}

function mwei(value) {
  return web3.utils.toWei(value.toString(), 'mwei').toString(10);
}

async function getResTimestamp(res) {
  return (await web3.eth.getBlock(res.receipt.blockNumber)).timestamp.toString();
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

const { BN } = web3.utils;

const increaseTime = buildEndpoint('evm_increaseTime');

async function latestBlock () {
  const block = await web3.eth.getBlock('latest');
  return new BN(block.timestamp);
}

async function increaseTimeTo (target) {
  if (!BN.isBN(target)) {
    target = new BN(target);
  }

  const now = (await latestBlock());

  if (target.lt(now)) throw Error(`Cannot increase current time (${now}) to a moment in the past (${target})`);
  const diff = target.sub(now);
  return increaseTime(diff.toNumber());
}

function buildEndpoint(endpoint) {
    return async function(...args) {
      return new Promise((resolve, reject) => {
        web3.currentProvider.send(
          {
            jsonrpc: '2.0',
            method: endpoint,
            params: args,
            id: getCounter(),
          },
          async (err, res) => {
            if (err) {
              return reject(err);
            }
            if (res.error && res.error.message && res.error.message.length > 0) {
              let err = new Error(`'${endpoint}' call failed`);
              err.stack = res.error.data.stack;
              err.name = res.error.data.name;
              return reject(err);
            }
            return resolve(res.result);
          },
        );
      });
    }
  }

async function forkReplacePoolTokenWithNewPiToken(
  artifacts,
  ethers,
  controller,
  tokenAddress,
  factoryAddress,
  routerArgs,
  admin
) {
  const MockERC20 = await artifacts.require('MockERC20');
  const token = await MockERC20.at(tokenAddress);
  const PowerIndexPool = await artifacts.require('PowerIndexPool');
  const WrappedPiErc20 = await artifacts.require('WrappedPiErc20');
  const AavePowerIndexRouter = await artifacts.require('AavePowerIndexRouter');
  const pool = await PowerIndexPool.at(await callContract(controller, 'pool'))
  console.log('pool getBalance before', await callContract(pool, 'getBalance', [token.address]));

  await pool.setController(controller.address, {from: admin});

  const res = await controller.replacePoolTokenWithNewPiToken(
    tokenAddress,
    factoryAddress,
    routerArgs,
    'Wrapped TOKEN',
    'WTOKEN',
    {from: admin}
  );

  const wrappedTokenAddress = res.logs.filter(l => l.event === 'CreatePiToken')[0].args.piToken;
  const wrappedToken = await WrappedPiErc20.at(wrappedTokenAddress);
  const router = await AavePowerIndexRouter.at(await callContract(wrappedToken, 'router', []));

  await increaseTime(60);

  await controller.finishReplace();

  await wrappedToken.pokeRouter();

  console.log('await callContract(pool, "isBound", [token])', await callContract(pool, "isBound", [tokenAddress]));
  console.log('await callContract(pool, "isBound", [wrappedTokenAddress])', await callContract(pool, "isBound", [wrappedTokenAddress]));

  return {
    token,
    wrappedToken,
    router
  }
}

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
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
  mwei,
  expectExactRevert,
  getResTimestamp,
  forkContractUpgrade,
  deployAndSaveArgs,
  impersonateAccount,
  increaseTime,
  increaseTimeTo,
  evmSetNextBlockTimestamp: buildEndpoint('evm_setNextBlockTimestamp'),
  impersonateAccount,
  callContract,
  forkReplacePoolTokenWithNewPiToken
}
