const shell = require('shelljs');

module.exports = {
  istanbulReporter: ['html'],
  providerOptions: {
    total_accounts: 30,
    default_balance_ether: BigInt(1e30).toString(),
  },
  mocha: {
    delay: false,
    timeout: 70000,
  },
  onCompileComplete: async function (_config) {
    // await run("typechain");
  },
  onIstanbulComplete: async function (_config) {
    /* We need to do this because solcover generates bespoke artifacts. */
    shell.rm('-rf', './artifacts');
    shell.rm('-rf', './typechain');
  },
  skipFiles: ['mocks', 'test', 'balancer-core/test', 'Migrations.sol', 'lib/UniswapV2Library.sol'],
};
