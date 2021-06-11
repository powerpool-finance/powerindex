require('@nomiclabs/hardhat-truffle5');

const fs = require('fs');

task('fetch-vaults-data-4', 'Fetch vaults data').setAction(async () => {
  const BPool = artifacts.require('BPool');
  const MockVault = artifacts.require('MockVault');
  const MockVaultRegistry = artifacts.require('MockCurvePoolRegistry');

  const vaultRegistry = await MockVaultRegistry.at('0x7D86446dDb609eD0F5f8684AcF30380a356b2B4c');
  const vaultsPool = await BPool.at('0x9ba60ba98413a60db4c651d4afe5c937bbd8044b');
  const vaults = await callContract(vaultsPool, 'getCurrentTokens');
  const vaultsData = [];

  const configByTokenAddress = {
    '0x6ede7f19df5df6ef23bd5b9cedb651580bdf56ca': {
      lpToken: '0x4807862aa8b2bf68830e4c8dc86d0e9a998e085a',
      depositor: '0xa79828df1850e8a3a3064576f380d90aecdd3359',
      amountsLength: 4,
      usdcIndex: 2,
    },
    '0xc4daf3b5e2a9e93861c3fbdd25f1e943b8d87417': {
      lpToken: '0x7eb40e450b9655f4b3cc4259bcc731c63ff55ae6',
      depositor: '0x3c8caee4e09296800f8d29a68fa3837e2dae4940',
      depositorType: 2,
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
    '0xf8768814b88281de4f532a3beefa5b85b69b9324': {
      lpToken: '0xecd5e75afb02efa118af914515d6521aabd189f1',
      depositor: '0xa79828df1850e8a3a3064576f380d90aecdd3359',
      depositorType: 2,
      amountsLength: 4,
      usdcIndex: 2,
    },
    '0xa74d4b67b3368e83797a35382afb776baae4f5c8': {
      lpToken: '0x43b4fdfd4ff969587185cdb6f0bd875c5fc83f8c',
      depositor: '0xa79828df1850e8a3a3064576f380d90aecdd3359',
      depositorType: 2,
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
