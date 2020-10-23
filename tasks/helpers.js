const TruffleContract = require('@nomiclabs/truffle-contract');
const { ether: etherBN, expectEvent } = require('@openzeppelin/test-helpers');
const { promisify } = require('util');
const BigNumber = require('bignumber.js')

const AdminUpgradeabilityProxyArtifact = require('@openzeppelin/upgrades-core/artifacts/AdminUpgradeabilityProxy.json');
const ProxyAdminArtifact = require('@openzeppelin/upgrades-core/artifacts/ProxyAdmin.json');
const template = artifacts.require('Reservoir');
const AdminUpgradeabilityProxy = TruffleContract(AdminUpgradeabilityProxyArtifact);
const ProxyAdmin = TruffleContract(ProxyAdminArtifact);

AdminUpgradeabilityProxy.setProvider(template.currentProvider);
AdminUpgradeabilityProxy.defaults(template.class_defaults);
ProxyAdmin.setProvider(template.currentProvider);
ProxyAdmin.defaults(template.class_defaults);

let proxyAdmin;

/**
 * Deploys a proxied contract
 *
 * @param contract Truffle Contract
 * @param {string[]} constructorArgs
 * @param {string[]} initializerArgs
 * @param {object} opts
 * @param {string} opts.deployer
 * @param {string} opts.initializer
 * @param {string} opts.proxyAdminOwner
 * @returns {Promise<any>}
 */
async function deployProxied(
    contract,
    constructorArgs = [],
    initializerArgs = [],
    opts = {}
) {
    const impl = await contract.new(...constructorArgs);
    const adminContract = await createOrGetProxyAdmin(opts.proxyAdminOwner);
    console.log('adminContract.address', adminContract.address);
    const data = getInitializerData(impl, initializerArgs, opts.initializer);
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

module.exports = {
    deployProxied,
}