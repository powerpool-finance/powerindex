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

  const erc20VaultPoolSwap = await Erc20VaultPoolSwap.new(usdcAddress);
  await zap.setPools([poolAddress], ['2']);
  await zap.setPoolsSwapContracts([poolAddress], [erc20VaultPoolSwap.address]);

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

  const BONUS_NUMERATOR = '7610350076';
  const BONUS_DENUMERATOR = '10000000000000000';
  const MIN_REPORT_INTERVAL = 1;
  const MAX_REPORT_INTERVAL = MIN_REPORT_INTERVAL + 60 * 60;
  const MAX_GAS_PRICE = gwei(500);
  const PER_GAS = '10000';
  const MIN_SLASHING_DEPOSIT = ether(40);

  await impersonateAccount(ethers, admin);
  await impersonateAccount(ethers, holder);
  await impersonateAccount(ethers, pokerReporter);
  await forkContractUpgrade(ethers, admin, proxyAdminAddr, poolAddress, await PowerIndexPool.new().then(r => r.address));

  const powerPoke = await PowerPoke.at(powerPokeAddress);
  await powerPoke.addClient(zap.address, admin, true, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, {from: admin});
  await powerPoke.setMinimalDeposit(zap.address, MIN_SLASHING_DEPOSIT, {from: admin});
  await powerPoke.setBonusPlan(zap.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {from: admin});
  await powerPoke.setFixedCompensations(zap.address, 200000, 60000, {from: admin});

  const cvp = await PowerIndexPool.at('0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1');
  await cvp.approve(powerPoke.address, ether(10000), {from: admin});
  await powerPoke.addCredit(zap.address, ether(10000), {from: admin});

  const usdc = await ERC20.at(usdcAddress);

  await pool.transfer(deployer, await callContract(pool, 'balanceOf', [holder]), {from: holder});

  await usdc.approve(zap.address, mwei(100000), {from: holder});
  await zap.depositErc20(poolAddress, usdc.address, mwei(100000), {from: holder});

  let roundKey = await callContract(zap, 'getLastRoundKey', [poolAddress, usdc.address, poolAddress]);

  await increaseTime(roundPeriod + 1);

  await usdc.approve(zap.address, mwei(100000), {from: holder});

  console.log('usdc balance before supply', fromMwei(await callContract(usdc, 'balanceOf', [zap.address])));

  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
    {to: pokerReporter, compensateInETH: false},
  );
  await zap.supplyAndRedeemPokeFromReporter('1', [roundKey], powerPokeOpts, {from: pokerReporter});

  console.log('usdc balance after supply', fromMwei(await callContract(usdc, 'balanceOf', [zap.address])));

  await zap.claimPokeFromReporter('1', roundKey, [holder], powerPokeOpts, {from: pokerReporter});

  const resultPoolBalance = await callContract(pool, 'balanceOf', [holder]);
  console.log('result pool balance', fromEther(resultPoolBalance));

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
  await usdc.approve(zap.address, mwei(100000), {from: holder});

  console.log('pool balance before redeem', fromEther(await callContract(pool, 'balanceOf', [zap.address])));

  await zap.supplyAndRedeemPokeFromReporter('1', [roundKey], powerPokeOpts, {from: pokerReporter});

  console.log('pool balance after redeem', fromEther(await callContract(pool, 'balanceOf', [zap.address])));

  await zap.claimPokeFromReporter('1', roundKey, [holder], powerPokeOpts, {from: pokerReporter});

  console.log('result usdc balance', fromMwei(await callContract(usdc, 'balanceOf', [holder])) - usdcBalanceBefore);
});
