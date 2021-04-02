require('@nomiclabs/hardhat-truffle5');

const fs = require('fs');

task('deploy-indices-supply-redeem-zap', 'Deploy Indices Supply Redeem Zap').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, forkContractUpgrade, ether, fromEther, mwei, fromMwei, gwei, deployProxied, callContract, increaseTime} = require('../test/helpers');
  const IndicesSupplyRedeemZap = artifacts.require('IndicesSupplyRedeemZap');
  const PowerIndexPool = artifacts.require('PowerIndexPool');
  const PowerPoke = await artifacts.require('PowerPoke');
  const Erc20VaultPoolSwap = await artifacts.require('Erc20VaultPoolSwap');

  const { web3 } = IndicesSupplyRedeemZap;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);

  const roundPeriod = 3600;
  const admin = '0xb258302c3f209491d604165549079680708581cc';
  const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const poolAddress = '0x9ba60ba98413a60db4c651d4afe5c937bbd8044b';
  const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';
  const curveRegistry = '0x7D86446dDb609eD0F5f8684AcF30380a356b2B4c';
  const zapAddress = '0x85c6d6b0cd1383cc85e8e36c09d0815daf36b9e9';

  const zapImplementation = await IndicesSupplyRedeemZap.new(usdcAddress, powerPokeAddress);
  console.log('zapImplementation.address', zapImplementation.address);

  const erc20VaultPoolSwap = await Erc20VaultPoolSwap.new(usdcAddress);

  const vd = JSON.parse(fs.readFileSync('data/vaultsData.json'));
  await erc20VaultPoolSwap.setVaultConfigs(
    vd.map(v => v.address),
    vd.map(v => v.config.depositor),
    vd.map(v => v.config.amountsLength),
    vd.map(v => v.config.usdcIndex),
    vd.map(v => v.config.lpToken),
    vd.map(() => curveRegistry),
  );
  await erc20VaultPoolSwap.updatePools([poolAddress]);

  if (network.name !== 'mainnetfork') {
    return;
  }
  const ERC20 = await artifacts.require('ERC20');
  const holder = '0xf977814e90da44bfa03b6295a0616a897441acec';
  const pool = await PowerIndexPool.at(poolAddress);
  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
  const usdc = await ERC20.at(usdcAddress);
  const zap = await IndicesSupplyRedeemZap.at(zapAddress);
  console.log('rounds', await callContract(zap, 'rounds', ['0xb0ac770a53389e30d4a541693349beb57f88723017479ae341e434f33eb8b815']));

  await impersonateAccount(ethers, holder);
  await impersonateAccount(ethers, pokerReporter);
  await forkContractUpgrade(ethers, admin, proxyAdminAddr, zapAddress, zapImplementation.address);
  console.log('poolType', await callContract(zap, 'poolType', [poolAddress]));
  console.log('tokenCap', await callContract(zap, 'tokenCap', [usdcAddress]));
  console.log('roundPeriod', await callContract(zap, 'roundPeriod', []));
  console.log('rounds', await callContract(zap, 'rounds', ['0xb0ac770a53389e30d4a541693349beb57f88723017479ae341e434f33eb8b815']));

  await pool.transfer(deployer, await callContract(pool, 'balanceOf', [holder]), {from: holder});

  await zap.setPoolsSwapContracts([poolAddress], [erc20VaultPoolSwap.address], {from: admin});

  const usdcIn = mwei(600000);
  await usdc.approve(zap.address, usdcIn, {from: holder});
  let roundKey = await callContract(zap, 'getLastRoundKey', [poolAddress, usdc.address, poolAddress]);
  await zap.depositErc20(poolAddress, usdc.address, usdcIn, {from: holder});

  await increaseTime(roundPeriod + 1);

  await usdc.approve(zap.address, usdcIn, {from: holder});

  console.log('usdc balance before supply', fromMwei(await callContract(usdc, 'balanceOf', [zap.address])));

  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
    {to: pokerReporter, compensateInETH: false},
  );
  const vaultPoolOutByUsdc = await callContract(erc20VaultPoolSwap,'calcVaultPoolOutByUsdc', [poolAddress, usdcIn]);
  await zap.supplyAndRedeemPokeFromReporter('1', [roundKey], powerPokeOpts, {from: pokerReporter});

  console.log('usdc balance after supply', fromMwei(await callContract(usdc, 'balanceOf', [zap.address])));

  await zap.claimPokeFromReporter('1', roundKey, [holder], powerPokeOpts, {from: pokerReporter});

  const resultPoolBalance = await callContract(pool, 'balanceOf', [holder]);
  console.log('result pool balance', fromEther(resultPoolBalance));
  console.log('vaultPoolOutByUsdc', fromEther(vaultPoolOutByUsdc));

  console.log('pool dust:');
  const tokens = await pool.getCurrentTokens();
  for (let i = 0; i < tokens.length; i++) {
    const token = await ERC20.at(tokens[i]);
    console.log(i + ' dust balanceOf', fromEther(await callContract(token, 'balanceOf', [zap.address])));
  }

  await pool.approve(zap.address, resultPoolBalance, {from: holder});
  await zap.depositPoolToken(poolAddress, usdc.address, resultPoolBalance, {from: holder});

  const usdcBalanceBefore = fromMwei(await callContract(usdc, 'balanceOf', [holder]));

  roundKey = await callContract(zap, 'getLastRoundKey', [poolAddress, poolAddress, usdc.address]);

  await increaseTime(roundPeriod + 1);
  await usdc.approve(zap.address, mwei(600000), {from: holder});

  console.log('pool balance before redeem', fromEther(await callContract(pool, 'balanceOf', [zap.address])));

  const usdcOutByPool = await callContract(erc20VaultPoolSwap,'calcUsdcOutByPool', [poolAddress, resultPoolBalance]);
  await zap.supplyAndRedeemPokeFromReporter('1', [roundKey], powerPokeOpts, {from: pokerReporter});

  console.log('pool balance after redeem', fromEther(await callContract(pool, 'balanceOf', [zap.address])));

  await zap.claimPokeFromReporter('1', roundKey, [holder], powerPokeOpts, {from: pokerReporter});

  console.log('result usdc balance', fromMwei(await callContract(usdc, 'balanceOf', [holder])) - usdcBalanceBefore);
  console.log('usdcOutByPool', fromMwei(usdcOutByPool));
});
