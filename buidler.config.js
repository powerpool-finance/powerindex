const { usePlugin } = require('@nomiclabs/buidler/config');

usePlugin('@nomiclabs/buidler-ganache');
usePlugin('@nomiclabs/buidler-truffle5');
usePlugin('solidity-coverage');
usePlugin('buidler-contract-sizer');
usePlugin('buidler-gas-reporter');
require('./tasks/fetchPoolsData');
require('./tasks/deployVestedLpMining');

const fs = require('fs');
const homeDir = require('os').homedir();
const _ = require('lodash');

function getAccounts(network) {
  const path = homeDir + '/.ethereum/' + network;
  if (!fs.existsSync(path)) {
    return [];
  }
  return [_.trim('0x' + fs.readFileSync(path, { encoding: 'utf8' }))];
}

const ethers = require('ethers');
const testAccounts = [];
for (let i = 0; i < 20; i++) {
  testAccounts.push({
    privateKey: ethers.Wallet.createRandom()._signingKey().privateKey,
    balance: '1000000000000000000000000000',
  });
}

const config = {
  analytics: {
    enabled: false,
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: true,
  },
  defaultNetwork: 'buidlerevm',
  gasReporter: {
    currency: 'USD',
    enabled: !!process.env.REPORT_GAS,
  },
  mocha: {
    timeout: 20000,
  },
  networks: {
    buidlerevm: {
      chainId: 31337,
      accounts: testAccounts,
    },
    mainnet: {
      url: 'https://mainnet-eth.compound.finance',
      accounts: getAccounts('mainnet'),
      gasPrice: 30000000000,
      gasMultiplier: 2,
    },
    local: {
      url: 'http://127.0.0.1:8545',
    },
    kovan: {
      url: 'https://kovan-eth.compound.finance',
      accounts: getAccounts('kovan'),
      gasPrice: 1000000000,
      gasMultiplier: 2,
    },
    coverage: {
      url: 'http://127.0.0.1:8555',
    },
    ganache: {
      url: 'http://127.0.0.1:8545',
    },
  },
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    coverage: './coverage',
    coverageJson: './coverage.json',
    root: './',
    sources: './contracts',
    tests: './test',
  },
  solc: {
    /* https://buidler.dev/buidler-evm/#solidity-optimizer-support */
    optimizer: {
      enabled: true,
      runs: 200,
    },
    version: '0.6.12',
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
};

module.exports = config;
