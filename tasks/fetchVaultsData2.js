require('@nomiclabs/hardhat-truffle5');

const fs = require('fs');

const configByTokenAddress = require('./tasks/config/ylaPool');

task('fetch-vaults-data', 'Fetch vaults data').setAction(async () => {
  const BPool = artifacts.require('BPool');
  const MockVault = artifacts.require('MockVault');
  const ICurveDepositor = artifacts.require('ICurveDepositor');
  const MockCurvePoolRegistry = artifacts.require('MockCurvePoolRegistry');

  const vaultRegistry = await MockCurvePoolRegistry.at('0x7D86446dDb609eD0F5f8684AcF30380a356b2B4c');
  const vaultsPool = await BPool.at('0x9ba60ba98413a60db4c651d4afe5c937bbd8044b');
  const vaults = await callContract(vaultsPool, 'getCurrentTokens');
  const vaultsData = [];

  for (let i = 0; i < vaults.length; i++) {
    const vault = await MockVault.at(vaults[i]);
    const lpToken = await vault.token();
    const config = configByTokenAddress[vaults[i].toLowerCase()];
    const depositor = await ICurveDepositor.at(config.depositor);

    const vaultTotalSupply = await callContract(vault, 'totalSupply');
    const balancerPoolVaultBalance = await callContract(vaultsPool, 'getBalance', [vaults[i]]);
    vaultsData[i] = {
      address: vaults[i],
      curvePool: {
        virtualPrice: await callContract(vaultRegistry, 'get_virtual_price_from_lp_token', [lpToken]),
      },
      yearnVault: {
        totalSupply: vaultTotalSupply,
        crvValue: await callContract(vault, 'balance')
      },
      balancerPool: {
        vaultTokenBalance: balancerPoolVaultBalance,
        usdcEstimation: await callContract(depositor, 'calc_withdraw_one_coin', [balancerPoolVaultBalance, config.usdcIndex]),
        denormWeight: await callContract(vaultsPool, 'getDenormalizedWeight', [vaults[i]]),
        normWeight: await callContract(vaultsPool, 'getNormalizedWeight', [vaults[i]]),
      },
      config
    }
  }
  fs.writeFileSync('./data/vaultsData2.json', JSON.stringify(vaultsData, null, ' '));
});

async function callContract(contract, method, args = [], type = null) {
  console.log(contract.address, method, args);
  let result = await contract.contract.methods[method].apply(contract.contract, args).call();
  if (type === 'array') {
    result = [].concat(result);
  }
  return result;
}

module.exports = {};
