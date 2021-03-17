require('@nomiclabs/hardhat-truffle5');

const fs = require('fs');

task('deploy-indices-supply-redeem-zap', 'Deploy Indices Supply Redeem Zap').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, forkContractUpgrade, gwei, fromEther, mwei, fromMwei, ethUsed, deployProxied, callContract, increaseTime} = require('../test/helpers');
  const IndicesSupplyRedeemZap = artifacts.require('IndicesSupplyRedeemZap');
  const PowerIndexPool = artifacts.require('PowerIndexPool');
  const PowerPoke = await artifacts.require('PowerPoke');

  const { web3 } = IndicesSupplyRedeemZap;
  const { toWei } = web3.utils;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  // const sendOptions = { from: deployer };

  const roundPeriod = 3600;
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const admin = '0xb258302c3f209491d604165549079680708581cc';
  const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const poolAddress = '0x9ba60ba98413a60db4c651d4afe5c937bbd8044b';
  const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';
  const pvp = '0xD132973EaEbBd6d7ca7b88e9170f2CCA058de430';
  const curveRegistry = '0x7D86446dDb609eD0F5f8684AcF30380a356b2B4c';

  const zap = await deployProxied(
    IndicesSupplyRedeemZap,
    [usdcAddress, powerPokeAddress],
    [roundPeriod, pvp],
    {
      proxyAdmin: proxyAdminAddr,
      // proxyAdminOwner: admin,
      implementation: ''
    }
  );
  console.log('zap.address', zap.address);
  console.log('zap.initialImplementation.address', zap.initialImplementation.address);

  await zap.setPools([poolAddress], ['2']);

  const vd = JSON.parse(fs.readFileSync('data/vaultsData.json'));
  await zap.setVaultConfigs(
    vd.map(v => v.address),
    vd.map(v => v.config.depositor),
    vd.map(v => v.config.amountsLength),
    vd.map(v => v.config.usdcIndex),
    vd.map(v => v.config.lpToken),
    vd.map(v => curveRegistry),
  );

  if (network.name !== 'mainnetfork') {
    return;
  }
  const ERC20 = await artifacts.require('ERC20');
  const holder = '0xf977814e90da44bfa03b6295a0616a897441acec';
  const pool = await PowerIndexPool.at(poolAddress);

  await impersonateAccount(ethers, admin);
  await impersonateAccount(ethers, holder);
  await forkContractUpgrade(ethers, admin, proxyAdminAddr, poolAddress, await PowerIndexPool.new().then(r => r.address));

  const usdc = await ERC20.at(usdcAddress);

  await pool.transfer(deployer, await callContract(pool, 'balanceOf', [holder]), {from: holder});

  await usdc.approve(zap.address, mwei(100000), {from: holder});
  await zap.depositErc20(poolAddress, usdc.address, mwei(100000), {from: holder});

  const roundKey = await callContract(zap, 'getCurrentRoundKey', [poolAddress, usdc.address, poolAddress]);

  await increaseTime(roundPeriod + 1);

  await usdc.approve(zap.address, mwei(100000), {from: holder});

  console.log('usdc balance before supply', fromMwei(await callContract(usdc, 'balanceOf', [zap.address])));

  await zap.supplyAndRedeemPoke([roundKey]);

  console.log('usdc balance after supply', fromMwei(await callContract(usdc, 'balanceOf', [zap.address])));

  await zap.claimPoke(roundKey, [holder]);

  console.log('result pool balance', fromEther(await callContract(pool, 'balanceOf', [holder])));

  console.log('pool dust:');
  const tokens = await pool.getCurrentTokens();
  for (let i = 0; i < tokens.length; i++) {
    const token = await ERC20.at(tokens[i]);
    console.log(i + ' dust balanceOf', fromEther(await callContract(token, 'balanceOf', [zap.address])));
  }

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});
