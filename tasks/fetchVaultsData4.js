require('@nomiclabs/hardhat-truffle5');

const fs = require('fs');

task('fetch-vaults-data-4', 'Fetch vaults data').setAction(async () => {
  const BPool = artifacts.require('BPool');
  const MockVault = artifacts.require('MockVault');
  const MockVaultRegistry = artifacts.require('MockCurvePoolRegistry');

  const vaultRegistry = await MockVaultRegistry.at('0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5');
  const vaultsPool = await BPool.at('0x9ba60ba98413a60db4c651d4afe5c937bbd8044b');
  const vaults = await callContract(vaultsPool, 'getCurrentTokens');
  const vaultsData = [];

  const configByTokenAddress = {
    '0x6ede7f19df5df6ef23bd5b9cedb651580bdf56ca': {
      lpToken: '0x4807862aa8b2bf68830e4c8dc86d0e9a998e085a',
      depositor: '0xa79828df1850e8a3a3064576f380d90aecdd3359',
      depositorType: 2,
      amountsLength: 4,
      usdcIndex: 2,
    },
    '0xc4daf3b5e2a9e93861c3fbdd25f1e943b8d87417': {
      lpToken: '0x7eb40e450b9655f4b3cc4259bcc731c63ff55ae6',
      depositor: '0x3c8caee4e09296800f8d29a68fa3837e2dae4940',
      depositorType: 1,
      amountsLength: 4,
      usdcIndex: 2,
    },
    '0x5fa5b62c8af877cb37031e0a3b2f34a78e3c56a6': {
      lpToken: '0xed279fdd11ca84beef15af5d39bb4d4bee23f0ca',
      depositor: '0xa79828df1850e8a3a3064576f380d90aecdd3359',
      depositorType: 2,
      amountsLength: 4,
      usdcIndex: 2,
    },
    '0x3b96d491f067912d18563d56858ba7d6ec67a6fa': {
      lpToken: '0x4f3e8f405cf5afc05d68142f3783bdfe13811522',
      depositor: '0x094d12e5b541784701fd8d65f11fc0598fbc6332',
      depositorType: 1,
      amountsLength: 4,
      usdcIndex: 2,
    }
  };

  for (let i = 0; i < vaults.length; i++) {
    const vault = await MockVault.at(vaults[i]);
    const lpToken = await callContract(vault, 'token');
    const config = configByTokenAddress[vaults[i].toLowerCase()];

    vaultsData[i] = {
      address: vaults[i],
      totalSupply: await callContract(vault, 'totalSupply'),
      usdtValue: await callContract(vault, 'totalAssets'),
      balancerBalance: await callContract(vaultsPool, 'getBalance', [vaults[i]]),
      usdcToLpRate: await callContract(vaultRegistry, 'get_virtual_price_from_lp_token', [lpToken]),
      config
    }
  }
  fs.writeFileSync('./data/vaultsData4.json', JSON.stringify(vaultsData, null, ' '));
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
