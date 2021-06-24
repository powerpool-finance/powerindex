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
  const Erc20VaultPoolSwap = await artifacts.require('Erc20VaultPoolSwap');
  const IndicesSupplyRedeemZap = artifacts.require('IndicesSupplyRedeemZap');
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
  const curvePoolRegistryAddress = '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5';

  const curvePoolRegistry = await ICurvePoolRegistry.at(curvePoolRegistryAddress);

  console.log('getTVLByTokensBalances', await getTVLByTokensBalances([
    '0xA74d4B67b3368E83797a35382AFB776bAAE4F5C8',
    '0xf8768814b88281DE4F532a3beEfA5b85B69b9324',
    '0x5fA5B62c8AF877CB37031e0a3B2f34A78e3C56A6',
    '0xC4dAf3b5e2A9e93861c3FBDd25f1e943B8D87417',
    '0x6Ede7F19df5df6EF23bD5B9CeDb651580Bdf56Ca'
  ], [
    ether('2912630.724533'),
    ether('21833.674103'),
    ether('2387190.259384'),
    ether('1561732.602546'),
    ether('1553130.9825912924')
  ]))

  const balanceBefore = fromEther(await web3.eth.getBalance(deployer));
  const weightStrategy =  await deployProxied(
    YearnVaultInstantRebindStrategy,
    [poolAddress, usdcAddress],
    [powerPokeAddress, curvePoolRegistryAddress, poolControllerAddress, 5000, {
      minUSDCRemainder: '20',
      useVirtualPriceEstimation: false
    }],
    {
      proxyAdmin: proxyAdminAddr,
      // proxyAdminOwner: admin,
      implementation: '' //0x60ef52b6d56f59817481935f5b2028cfc23c14d3
    }
  );
  // const weightStrategy = await YearnVaultInstantRebindStrategy.at('0xea20d1d24bd9ae0e4ad3982f302d8441ca5e5b99');
  console.log('weightStrategyProxy.address', weightStrategy.address);
  // console.log('weightStrategyImplementation.address', weightStrategy.initialImplementation.address);

  const controller = await PowerIndexPoolController.new(poolAddress, zeroAddress, zeroAddress, weightStrategy.address);
  // const controller = await PowerIndexPoolController.at('0x750f973f8f2dfe0999321243bf67fa36df7dcb33');
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
  console.log('ETH spent', balanceBefore - fromEther(await web3.eth.getBalance(deployer)))

  if (network.name !== 'mainnetfork') {
    return;
  }
  await impersonateAccount(ethers, admin);

  const pool = await PowerIndexPool.at(poolAddress);
  await forkContractUpgrade(ethers, admin, proxyAdminAddr, weightStrategy.address, '0x53edc5519464559b1c1aad384f188e149c3e36d4');

  if(controller.address.toLowerCase() !== await callContract(pool, 'getController').then(c => c.toLowerCase())) {
    await pool.setWrapper(zeroAddress, true, {from: admin});
    await pool.setController(controller.address, {from: admin});
    const cfg = configByTokenAddress['0x3B96d491f067912D18563d56858Ba7d6EC67a6fa'];
    await weightStrategy.setVaultConfig(
      '0x3B96d491f067912D18563d56858Ba7d6EC67a6fa',
      cfg.depositor,
      cfg.depositorType || '1',
      cfg.amountsLength,
      cfg.usdcIndex,
      {from: admin}
    );
  }
  const [poolTvlBefore] = await getTVL(pool);
  let cpRes = await weightStrategy.changePoolTokens([
    '0xd6ea40597be05c201845c0bfd2e96a60bacde267', //'0x6Ede7F19df5df6EF23bD5B9CeDb651580Bdf56Ca',
    '0x84e13785b5a27879921d6f685f041421c7f482da', //'0xC4dAf3b5e2A9e93861c3FBDd25f1e943B8D87417',
    '0x5fA5B62c8AF877CB37031e0a3B2f34A78e3C56A6',
    '0x3B96d491f067912D18563d56858Ba7d6EC67a6fa'
  ], {from: admin});
  console.log('res.receipt.gasUsed', cpRes.receipt.gasUsed);

  cpRes = await weightStrategy.changePoolTokens([
    '0x6Ede7F19df5df6EF23bD5B9CeDb651580Bdf56Ca',
    '0xC4dAf3b5e2A9e93861c3FBDd25f1e943B8D87417',
    '0x5fA5B62c8AF877CB37031e0a3B2f34A78e3C56A6',
    '0x3B96d491f067912D18563d56858Ba7d6EC67a6fa',
  ], {from: admin});
  console.log('res.receipt.gasUsed', cpRes.receipt.gasUsed);

  const [poolTvlAfter] = await getTVL(pool);

  console.log('poolTvlBefore', poolTvlBefore);
  console.log('poolTvlAfter', poolTvlAfter);

  const zapAddress = '0x85c6d6b0cd1383cc85e8e36c09d0815daf36b9e9';
  const zap = await IndicesSupplyRedeemZap.at(zapAddress);
  const erc20VaultPoolSwap = await Erc20VaultPoolSwap.new(usdcAddress);

  const vd = JSON.parse(fs.readFileSync('data/vaultsData.json'));
  await erc20VaultPoolSwap.setVaultConfigs(
    vd.map(v => v.address),
    vd.map(v => v.config.depositor),
    vd.map(v => v.config.amountsLength),
    vd.map(v => v.config.usdcIndex),
    vd.map(v => v.config.lpToken),
    vd.map(() => curvePoolRegistryAddress),
  );
  await erc20VaultPoolSwap.updatePools([poolAddress]);

  await zap.setPoolsSwapContracts([poolAddress], [erc20VaultPoolSwap.address]);

  await increaseTime(roundPeriod + 1);

  return;

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

  async function getTVLByTokensBalances(tokens, balances, weights) {
    let bpoolEval = 0n;
    let totalEval = 0n;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const vault = await IVault.at(token);
      // bpool eval
      {
        const vaultBalance = balances[index];
        console.log('balance', token, fromEther(vaultBalance), 'weight', weights ? fromEther(weights[index]) * 100 : 'unknown');
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

  async function getTVL(pool) {
    /** @type {string[]} */
    const tokens = await pool.getCurrentTokens();
    console.log('tokens', tokens);

    const balances = [];
    const weights = [];
    for (let token of tokens) {
      const vault = await IVault.at(token);
      balances.push(await vault.balanceOf(pool.address));
      weights.push(await pool.getNormalizedWeight(token).catch(() => '0'));
    }
    return getTVLByTokensBalances(tokens, balances, weights);
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
