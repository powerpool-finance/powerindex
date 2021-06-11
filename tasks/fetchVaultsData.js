require('@nomiclabs/hardhat-truffle5');

const fs = require('fs');

task('fetch-vaults-data', 'Fetch vaults data').setAction(async () => {
  const BPool = artifacts.require('BPool');
  const MockVault = artifacts.require('MockVault');
  const MockVaultRegistry = artifacts.require('MockVaultRegistry');

  const vaultRegistry = await MockVaultRegistry.at('0x7D86446dDb609eD0F5f8684AcF30380a356b2B4c');
  const vaultsPool = await BPool.at('0x9ba60ba98413a60db4c651d4afe5c937bbd8044b');
  const vaults = await callContract(vaultsPool, 'getCurrentTokens');
  const vaultsData = [];

  const configByTokenAddress = {
    '0x629c759d1e83efbf63d84eb3868b564d9521c129': {
      lpToken: '0x845838df265dcd2c412a1dc9e959c7d08537f8a2',
      depositor: '0xeb21209ae4c2c9ff2a86aca31e123764a3b6bc06',
      amountsLength: 2,
      usdcIndex: 1,
    },
    '0x9ca85572e6a3ebf24dedd195623f188735a5179f': {
      lpToken: '0x6c3f90f043a72fa612cbac8115ee7e52bde6e490',
      depositor: '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7',
      amountsLength: 3,
      usdcIndex: 1,
    },
    '0xcc7e70a958917cce67b4b87a8c30e6297451ae98': {
      lpToken: '0xd2967f45c4f384deea880f807be904762a3dea07',
      depositor: '0x64448b78561690b70e17cbe8029a3e5c1bb7136e',
      amountsLength: 4,
      usdcIndex: 2,
    },
    '0x5dbcf33d8c2e976c6b560249878e6f1491bca25c': {
      lpToken: '0xdf5e0e81dff6faf3a7e52ba697820c5e32d806a8',
      depositor: '0xbbc81d23ea2c3ec7e56d39296f0cbb648873a5d3',
      amountsLength: 4,
      usdcIndex: 1,
    },
    '0x2994529c0652d127b7842094103715ec5299bbed': {
      lpToken: '0x3b3ac5386837dc563660fb6a0937dfaa5924333b',
      depositor: '0xb6c057591e073249f2d9d88ba59a46cfc9b59edb',
      amountsLength: 4,
      usdcIndex: 1,
    }
  };

  for (let i = 0; i < vaults.length; i++) {
    const vault = await MockVault.at(vaults[i]);
    const lpToken = await vault.token();
    const config = configByTokenAddress[vaults[i].toLowerCase()];

    vaultsData[i] = {
      address: vaults[i],
      totalSupply: await callContract(vault, 'totalSupply'),
      usdtValue: await callContract(vault, 'balance'),
      balancerBalance: await callContract(vaultsPool, 'getBalance', [vaults[i]]),
      usdcToLpRate: await callContract(vaultRegistry, 'get_virtual_price_from_lp_token', [lpToken]),
      config
    }
  }
  fs.writeFileSync('./data/vaultsData.json', JSON.stringify(vaultsData, null, ' '));
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
