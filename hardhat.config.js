require('@powerpool/hardhat-ganache');
require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-etherscan');
require('solidity-coverage');
require('hardhat-contract-sizer');
require('hardhat-gas-reporter');
require('./tasks/fetchPoolsData');
require('./tasks/fetchVaultsData');
require('./tasks/fetchVaultsData3');
require('./tasks/fetchVaultsData4');
require('./tasks/deployVestedLpMining');
require('./tasks/deployMainnetPowerIndexPool');
require('./tasks/deployErc20PiptSwap');
require('./tasks/testMainnetErc20PiptSwap');
require('./tasks/deployPoolRestrictions');
require('./tasks/deployMainnetYeti');
require('./tasks/deployYearnRouter');
require('./tasks/deployAaveRouter');
require('./tasks/deploySushiRouterForAssy');
require('./tasks/deploySushiRouterForYeti');
require('./tasks/deployProxyFactory');
require('./tasks/deployMainnetAssy');
require('./tasks/deployMainnetYla');
require('./tasks/rebindMCapWeights');
require('./tasks/deployMainnetWeightsStrategy');
require('./tasks/deployMainnetInstantRebindStrategy');
require('./tasks/testVestedLpMiningProxy');
require('./tasks/testVestedLpMiningPool');
require('./tasks/deployIndicesSupplyRedeemZap');
require('./tasks/deployXCVP');

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
    // 1e12 * 1e18
    balance: '1000000000000000000000000000000',
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
  defaultNetwork: 'hardhat',
  gasReporter: {
    currency: 'USD',
    enabled: !!process.env.REPORT_GAS,
  },
  mocha: {
    timeout: 70000,
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: testAccounts,
      allowUnlimitedContractSize: true,
      gas: 12000000,
      loggingEnabled: false,
      blockGasLimit: 12000000,
    },
    ganache: {
      url: 'http://127.0.0.1:8945',
      defaultBalanceEther: 1e9,
      hardfork: 'muirGlacier',
    },
    mainnet: {
      url: 'https://mainnet-eth.compound.finance',
      accounts: getAccounts('mainnet'),
      gasPrice: 48 * 10 ** 9,
      gasMultiplier: 1.2,
      timeout: 2000000,
    },
    mainnetfork: {
      url: 'http://127.0.0.1:8545/',
      gasPrice: 48 * 10 ** 9,
      // accounts: getAccounts('mainnet'),
      gasMultiplier: 1.2,
      timeout: 2000000,
      blockGasLimit: 20000000,
      allowUnlimitedContractSize: true,
    },
    local: {
      url: 'http://127.0.0.1:8545',
    },
    kovan: {
      url: 'https://kovan-eth.compound.finance',
      accounts: getAccounts('kovan'),
      gasPrice: 10 ** 9,
      gasMultiplier: 2,
    },
    coverage: {
      url: 'http://127.0.0.1:8555',
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
  solidity: {
    settings: {
      optimizer: {
        enabled: !!process.env.ETHERSCAN_KEY || process.env.COMPILE_TARGET === 'release',
        runs: 200,
      },
    },
    version: '0.6.12',
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY,
  },
};

module.exports = config;
