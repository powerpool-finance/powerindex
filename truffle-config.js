const web3 = require('web3');
const homedir = require('os').homedir();
const fs = require('fs');
const path = require('path');
const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
  // Uncommenting the defaults below
  // provides for an easier quick-start with Ganache.
  // You can also follow this format for other networks;
  // see <http://truffleframework.com/docs/advanced/configuration>
  // for more details on how to specify configuration options!
  //
  //networks: {
  //  development: {
  //    host: "127.0.0.1",
  //    port: 7545,
  //    network_id: "*"
  //  },
  //  test: {
  //    host: "127.0.0.1",
  //    port: 7545,
  //    network_id: "*"
  //  }
  //}
  //
  networks: {
    mainnet: {
      host: 'https://mainnet.infura.io/v3/0451559fb28d46b7b7489fbb87062222', // Localhost (default: none)
      port: 8545, // Standard Ethereum port (default: none)
      provider: () =>
        new HDWalletProvider(
          fs.readFileSync(path.join(homedir, '.ethereum', 'mainnet'), { encoding: 'utf8' }),
          new web3.providers.WebsocketProvider('wss://mainnet.infura.io/ws/v3/0451559fb28d46b7b7489fbb87062222'),
          0,
          100,
        ),
      network_id: 1,
      gas: 7000000,
      gasPrice: 60000000000,
      confirmations: 2,
      timeoutBlocks: 200,
      allowUnlimitedContractSize: true,
      skipDryRun: true,
    },
    kovan: {
      host: 'https://kovan.infura.io/v3/0451559fb28d46b7b7489fbb87062222', // Localhost (default: none)
      port: 8545, // Standard Ethereum port (default: none)
      provider: () =>
        new HDWalletProvider(
          fs.readFileSync(path.join(homedir, '.ethereum', 'kovan'), { encoding: 'utf8' }),
          new web3.providers.WebsocketProvider('wss://kovan.infura.io/ws/v3/0451559fb28d46b7b7489fbb87062222'),
          0,
          100,
        ),
      network_id: 42,
      gas: 12000000,
      gasPrice: 1000000000,
      confirmations: 2,
      timeoutBlocks: 200,
      allowUnlimitedContractSize: true,
      skipDryRun: true,
    },
  },
  compilers: {
    solc: {
      version: '0.6.12',
      settings: {
        optimizer: {
          enabled: true,
          runs: 0,
        },
      },
    },
  },
};
