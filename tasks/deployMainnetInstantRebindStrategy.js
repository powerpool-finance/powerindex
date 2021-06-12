require('@nomiclabs/hardhat-truffle5');

const configByTokenAddress = require('./config/ylaPool');

task('deploy-mainnet-instant-rebind-strategy', 'Deploy Mainnet Instant Rebind Strategy').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, gwei, fromEther, ethUsed, deployProxied, callContract, forkContractUpgrade} = require('../test/helpers');
  const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
  const PowerIndexPool = artifacts.require('PowerIndexPool');
  const IVault = artifacts.require('IVault');
  const YearnVaultInstantRebindStrategy = artifacts.require('YearnVaultInstantRebindStrategy');
  const ICurvePoolRegistry = artifacts.require('ICurvePoolRegistry');
  const PowerPoke = await artifacts.require('PowerPoke');
  const ERC20 = await artifacts.require('@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20');
  const { web3 } = PowerIndexPoolController;
  YearnVaultInstantRebindStrategy.numberFormat = 'String';
  ICurvePoolRegistry.numberFormat = 'String';

  const { toWei } = web3.utils;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  // const sendOptions = { from: deployer };
  const oneE9 = BigInt(1e9);

  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const admin = '0xb258302c3f209491d604165549079680708581cc';
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const poolAddress = '0x9ba60ba98413a60db4c651d4afe5c937bbd8044b';
  const poolControllerAddress = '0xb258302c3f209491d604165549079680708581cc';
  const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';
  const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const curePoolRegistryAddress = '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5';

  const weightStrategy =  await deployProxied(
    YearnVaultInstantRebindStrategy,
    [poolAddress, usdcAddress],
    [powerPokeAddress, curePoolRegistryAddress, poolControllerAddress, 5000, {
      minUSDCRemainder: '20',
      useVirtualPriceEstimation: false
    }],
    {
      proxyAdmin: proxyAdminAddr,
      // proxyAdminOwner: admin,
      implementation: ''
    }
  );
  // const weightStrategy = await YearnVaultInstantRebindStrategy.at('0x1Ba0CbCA5571d9c27CBe266701789c4Ab6D25CcE');
  console.log('weightStrategyProxy.address', weightStrategy.address);
  // console.log('weightStrategyImplementation.address', weightStrategy.initialImplementation.address);

  const controller = await PowerIndexPoolController.new(poolAddress, zeroAddress, zeroAddress, weightStrategy.address);
  // const controller = await PowerIndexPoolController.at('0x45dEE342d89d9B9f789908c3b5722F8b78F7F565');
  console.log('controller.address', controller.address);
  await weightStrategy.setPoolController(controller.address);

  for (let vaultAddress of Object.keys(configByTokenAddress)) {
    const cfg = configByTokenAddress[vaultAddress];
    await weightStrategy.setVaultConfig(
      vaultAddress,
      cfg.depositor,
      cfg.depositorType || '1',
      cfg.amountsLength,
      cfg.usdcIndex,
    );
  }
  await weightStrategy.syncPoolTokens();

  await weightStrategy.transferOwnership(admin);

  if (network.name !== 'mainnetfork') {
    return;
  }
  await impersonateAccount(ethers, admin);

  const curvePoolRegistry = await ICurvePoolRegistry.at(curePoolRegistryAddress);

  const pool = await PowerIndexPool.at(poolAddress);
  await forkContractUpgrade(ethers, admin, proxyAdminAddr, pool.address, await PowerIndexPool.new().then(p => p.address));
  if(controller.address.toLowerCase() !== await callContract(pool, 'getController').then(c => c.toLowerCase())) {
    await pool.setController(controller.address, {from: admin});
  }
  console.log('controller', await callContract(pool, 'getController'))

  const [poolTvlBefore] = await getTVL(pool);
  let cpRes = await weightStrategy.changePoolTokens([
    '0xd6ea40597be05c201845c0bfd2e96a60bacde267', //'0x6ede7f19df5df6ef23bd5b9cedb651580bdf56ca',
    '0x84e13785b5a27879921d6f685f041421c7f482da', //'0xc4daf3b5e2a9e93861c3fbdd25f1e943b8d87417',
    '0x2a38b9b0201ca39b17b460ed2f11e4929559071e', //'0x5fa5b62c8af877cb37031e0a3b2f34a78e3c56a6',
    '0xf8768814b88281de4f532a3beefa5b85b69b9324',
    '0xa74d4b67b3368e83797a35382afb776baae4f5c8'
  ], {from: admin});
  console.log('res.receipt.gasUsed', cpRes.receipt.gasUsed);

  cpRes = await weightStrategy.changePoolTokens([
    '0xd6ea40597be05c201845c0bfd2e96a60bacde267', //'0x6ede7f19df5df6ef23bd5b9cedb651580bdf56ca',
    '0xc4daf3b5e2a9e93861c3fbdd25f1e943b8d87417',
    '0x5fa5b62c8af877cb37031e0a3b2f34a78e3c56a6',
    '0xf8768814b88281de4f532a3beefa5b85b69b9324',
    '0xa74d4b67b3368e83797a35382afb776baae4f5c8'
  ], {from: admin});
  console.log('res.receipt.gasUsed', cpRes.receipt.gasUsed);

  cpRes = await weightStrategy.changePoolTokens([
    '0x6ede7f19df5df6ef23bd5b9cedb651580bdf56ca',
    '0xc4daf3b5e2a9e93861c3fbdd25f1e943b8d87417',
    '0x5fa5b62c8af877cb37031e0a3b2f34a78e3c56a6',
    '0xf8768814b88281de4f532a3beefa5b85b69b9324',
    '0xa74d4b67b3368e83797a35382afb776baae4f5c8'
  ], {from: admin});
  console.log('res.receipt.gasUsed', cpRes.receipt.gasUsed);

  const [poolTvlAfter] = await getTVL(pool);

  console.log('poolTvlBefore', poolTvlBefore);
  console.log('poolTvlAfter', poolTvlAfter);

  const BONUS_NUMERATOR = '7610350076';
  const BONUS_DENUMERATOR = '10000000000000000';
  const MIN_REPORT_INTERVAL = 60 * 60 * 24 * 14;
  const MAX_REPORT_INTERVAL = MIN_REPORT_INTERVAL + 60 * 60;
  const MAX_GAS_PRICE = gwei(500);
  const PER_GAS = '10000';
  const MIN_SLASHING_DEPOSIT = ether(40);

  const powerPoke = await PowerPoke.at(powerPokeAddress);
  await powerPoke.addClient(weightStrategy.address, admin, true, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, {from: admin});
  await powerPoke.setMinimalDeposit(weightStrategy.address, MIN_SLASHING_DEPOSIT, {from: admin});
  await powerPoke.setBonusPlan(weightStrategy.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {from: admin});
  await powerPoke.setFixedCompensations(weightStrategy.address, 200000, 60000, {from: admin});

  const cvp = await PowerIndexPool.at('0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1');
  await cvp.approve(powerPoke.address, ether(10000), {from: admin});
  await powerPoke.addCredit(weightStrategy.address, ether(10000), {from: admin});

  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
  await impersonateAccount(ethers, pokerReporter);
  const testWallet = ethers.Wallet.createRandom();
  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
    {to: testWallet.address, compensateInETH: true},
  );

  const [beforePool, beforeVault] = await getTVL(pool);
  console.log('>>> poking...');
  const res = await weightStrategy.pokeFromReporter('1', powerPokeOpts, {from: pokerReporter});
  console.log('>>> poke done');
  console.log('logs', JSON.stringify(res.logs.filter(l => l.event === 'InstantRebind'), null, 2))
  console.log('filtered', filterPushPullLogs(res.logs));
  const [afterPool, afterVault] = await getTVL(pool);

  console.log('pool diff  ', fromEther(beforePool - afterPool));
  console.log('vault diff ', fromEther(beforeVault - afterVault));
  console.log('beforePool ', fromEther(beforePool));
  console.log('afterPool  ', fromEther(afterPool));
  console.log('beforeVault', fromEther(beforeVault));
  console.log('afterVault ', fromEther(afterVault));

  for (let vaultAddress of Object.keys(configByTokenAddress)) {
    const vault = await ERC20.at(vaultAddress);
    console.log('withdrawal fee paid (in crv*)', await vault.symbol(), fromEther(await weightStrategy.fees(vaultAddress)));
  }

  console.log('powerPoke rewards', fromEther(await powerPoke.rewards('1')));
  console.log('ETH used', await ethUsed(web3, res.receipt));
  console.log('ETH compensation', fromEther(await web3.eth.getBalance(testWallet.address)));

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }

  async function getTVL(pool) {
    /** @type {string[]} */
    const tokens = await pool.getCurrentTokens();
    let bpoolEval = 0n;
    let totalEval = 0n;
    for (let token of tokens) {
      const vault = await IVault.at(token);
      // bpool eval
      {
        const vaultBalance = await vault.balanceOf(pool.address);
        const vaultPerShare = await vault.pricePerShare();
        const crvBalance = BigInt(vaultBalance) * BigInt(vaultPerShare) / (10n ** 18n);
        const virtualPrice = await curvePoolRegistry.get_virtual_price_from_lp_token(await vault.token());
        const tokenBpoolEval = (BigInt(crvBalance) * BigInt(virtualPrice)) / (10n ** 18n);
        bpoolEval += tokenBpoolEval;
      }

      // total eval
      {
        const crvBalance = await vault.totalAssets();
        const virtualPrice = await curvePoolRegistry.get_virtual_price_from_lp_token(await vault.token());
        const tokenBpoolEval = (BigInt(crvBalance) * BigInt(virtualPrice)) / (10n ** 18n);

        totalEval += tokenBpoolEval;
      }
    }
    return [bpoolEval, totalEval];
  }

  async function filterPushPullLogs(logs) {
    return logs
      .filter(l => l.event === 'PushLiquidity' || l.event === 'PullLiquidity')
      .map(l => {
        const e = {
          action: l.event,
          vaultToken: l.args.vaultToken,
          crvToken: l.args.crvToken,
          vaultAmount: Number(BigInt(l.args.vaultAmount) / oneE9) / 1e9 ,
          usdcAmount: Number(l.args.usdcAmount) / 1e6,
        }
        if (l.event === 'PullLiquidity') {
          e.vaultReserve = Number(BigInt(l.args.vaultReserve) / oneE9) / 1e9;
          e.crvExpected = Number(BigInt(l.args.crvAmountExpected) / oneE9) / 1e9;
          e.crvActual = Number(BigInt(l.args.crvAmountActual) / oneE9) / 1e9;
        } else {
          e.crvAmount = Number(BigInt(l.args.crvAmount) / oneE9) / 1e9;
        }
        return e;
      })
  }
});
