const fs = require('fs');

const { time } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const MockERC20 = artifacts.require('MockERC20');
const UniswapV2Factory = artifacts.require('MockUniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
const WETH = artifacts.require('MockWETH');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const ProxyFactory = artifacts.require('ProxyFactory');
const MCapWeightStrategy = artifacts.require('MCapWeightStrategy');
const MockOracle = artifacts.require('MockOracle');
const PowerPoke = artifacts.require('PowerPoke');
const MockFastGasOracle = artifacts.require('MockFastGasOracle');
const MockStaking = artifacts.require('MockStaking');
const MockCvp = artifacts.require('MockCvp');
const ethers = require('ethers');
const pIteration = require('p-iteration');

WETH.numberFormat = 'String';
MockERC20.numberFormat = 'String';
UniswapV2Pair.numberFormat = 'String';
UniswapV2Router02.numberFormat = 'String';
MCapWeightStrategy.numberFormat = 'String';
PowerIndexPool.numberFormat = 'String';
PowerPoke.numberFormat = 'String';

const { web3 } = PowerIndexPoolFactory;
const { toBN } = web3.utils;

const { deployProxied, gwei } = require('../helpers');
function ether(val) {

  return web3.utils.toWei(val.toString(), 'ether').toString();
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

function divScalarBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .mul(toBN(ether('1').toString(10)))
    .div(toBN(bn2.toString(10)))
    .toString(10);
}
function mulScalarBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .mul(toBN(bn2.toString(10)))
    .div(toBN(ether('1').toString(10)))
    .toString(10);
}

function assertEqualWithAccuracy(bn1, bn2, accuracyPercentWei = '100000000') {
  bn1 = toBN(bn1.toString(10));
  bn2 = toBN(bn2.toString(10));
  const bn1GreaterThenBn2 = bn1.gt(bn2);
  let diff = bn1GreaterThenBn2 ? bn1.sub(bn2) : bn2.sub(bn1);
  let diffPercent = divScalarBN(diff, bn1);
  const lowerThenAccurancy = toBN(diffPercent).lte(toBN(accuracyPercentWei));
  assert.equal(lowerThenAccurancy, true, 'diffPercent is ' + web3.utils.fromWei(diffPercent, 'ether'));
}

describe('MCapWeightStrategy', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const swapFee = ether('0.0001');
  const communitySwapFee = ether('0.001');
  const communityJoinFee = ether('0.001');
  const communityExitFee = ether('0.001');

  const poolsData = JSON.parse(fs.readFileSync('data/poolsData.json', { encoding: 'utf8' }));

  let minter, feeManager, permanentVotingPower, uniswapRouter, weightStrategyOwner, reporter, reservoir;
  before(async function () {
    [minter, feeManager, permanentVotingPower, uniswapRouter, weightStrategyOwner, reporter, reservoir] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();
    this.weth.deposit({ value: ether('50000000') });

    const proxyFactory = await ProxyFactory.new();
    const impl = await PowerIndexPool.new();
    this.bFactory = await PowerIndexPoolFactory.new(
      proxyFactory.address,
      impl.address,
      zeroAddress,
      { from: minter }
    );
    this.bActions = await PowerIndexPoolActions.new({ from: minter });
    this.uniswapFactory = await UniswapV2Factory.new(feeManager, { from: minter });
    this.uniswapRouter = await UniswapV2Router02.new(this.uniswapFactory.address, this.weth.address, { from: minter });

    this.poolRestrictions = await PoolRestrictions.new();

    this.makePowerIndexPool = async (_tokens, _balances) => {
      const fromTimestamp = await getTimestamp(100);
      const targetTimestamp = await getTimestamp(100 + 60 * 60 * 24 * 5);
      for (let i = 0; i < _tokens.length; i++) {
        await _tokens[i].approve(this.bActions.address, '0x' + 'f'.repeat(64));
      }

      const weightPart = 50 / _tokens.length;
      const minWeightPerSecond = ether('0');
      const maxWeightPerSecond = ether('0.1');

      const res = await this.bActions.create(
        this.bFactory.address,
        'Test Pool',
        'TP',
        {
          minWeightPerSecond,
          maxWeightPerSecond,
          swapFee,
          communitySwapFee,
          communityJoinFee,
          communityExitFee,
          communityFeeReceiver: permanentVotingPower,
          finalize: true,
        },
        _tokens.map((t, i) => ({
          token: t.address,
          balance: _balances[i],
          targetDenorm: ether(weightPart),
          fromTimestamp: fromTimestamp.toString(),
          targetTimestamp: targetTimestamp.toString()
        })),
      );

      const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
      const pool = await PowerIndexPool.at(logNewPool.args.pool);
      await pool.setRestrictions(this.poolRestrictions.address, { from: minter });

      return pool;
    };

    this.checkWeights = async (pool, balancerTokens, weights) => {
      for (let i = 0; i < weights.length; i++) {
        const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
        assertEqualWithAccuracy(dw.targetDenorm, weights[i]);
      }
    };
  });

  describe('Swaps with Uniswap mainnet values', () => {
    let tokens, balancerTokens, bPoolBalances, pool, poolController, weightStrategy, oracle, poke, fastGasOracle, staking;

    const tokenBySymbol = {};
    const pokePeriod = 60 * 60 * 24;
    let compensationOpts;

    beforeEach(async () => {
      compensationOpts = web3.eth.abi.encodeParameter(
        {
          PokeRewardOptions: {
            to: 'address',
            compensateInETH: 'bool'
          },
        },
        {
          to: reporter,
          compensateInETH: false
        },
      );

      oracle = await MockOracle.new();

      const cvpToken = await MockCvp.new();
      fastGasOracle = await MockFastGasOracle.new(gwei(300 * 1000));
      staking = await deployProxied(
        MockStaking,
        [cvpToken.address],
        [minter, reservoir, zeroAddress, '0', '0', '60', '60'],
        { proxyAdminOwner: minter }
      );

      poke = await deployProxied(
        PowerPoke,
        [cvpToken.address, this.weth.address, fastGasOracle.address, uniswapRouter, staking.address],
        [minter, oracle.address],
        { proxyAdminOwner: minter }
      );

      await staking.setSlasher(poke.address);

      weightStrategy = await deployProxied(
        MCapWeightStrategy,
        [],
        [oracle.address, poke.address],
        { proxyAdminOwner: minter }
      );

      tokens = [];
      balancerTokens = [];
      bPoolBalances = [];

      await oracle.setPrice(this.weth.address, ether(1000));
      await oracle.setPrice(cvpToken.address, ether(1.5));

      for (let i = 0; i < poolsData.length; i++) {
        const token = await MockERC20.new(poolsData[i].tokenSymbol, poolsData[i].tokenSymbol, poolsData[i].tokenDecimals, poolsData[i].totalSupply);

        console.log('token.address', token.address, 'poolsData.oraclePrice', poolsData[i].oraclePrice);
        await oracle.setPrice(token.address, poolsData[i].oraclePrice);
        const excludeAddresses = await pIteration.map(poolsData[i].excludeBalances, (bal) => {
          const {address} = ethers.Wallet.createRandom();
          token.transfer(address, bal);
          return address;
        });
        await weightStrategy.setExcludeTokenBalances(token.address, excludeAddresses);

        tokens.push(token);
        bPoolBalances.push(poolsData[i].balancerBalance);

        tokenBySymbol[poolsData[i].tokenSymbol] = {
          token,
        };
      }

      balancerTokens =  tokens.filter((t, i) => poolsData[i].balancerBalance !== '0');

      pool = await this.makePowerIndexPool(balancerTokens, bPoolBalances.filter(b => b !== '0'));
      poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);
      await pool.setController(poolController.address);
      await weightStrategy.addPool(pool.address, poolController.address);
      await poolController.setWeightsStrategy(weightStrategy.address);

      await poke.addClient(weightStrategy.address, weightStrategyOwner, true, gwei(300), pokePeriod / 2, pokePeriod * 2, { from: minter });
      await cvpToken.approve(poke.address, ether(30000), { from: minter })
      await poke.addCredit(weightStrategy.address, ether(30000), { from: minter });
      await poke.setBonusPlan(weightStrategy.address, 1,  true, 25, 17520000, 100 * 1000, { from: weightStrategyOwner });

      const reporterDeposit = ether(10000);
      await poke.setMinimalDeposit(weightStrategy.address, reporterDeposit, { from: weightStrategyOwner });

      await cvpToken.transfer(reporter, reporterDeposit);
      await cvpToken.approve(staking.address, reporterDeposit, {from: reporter});
      await staking.createUser(reporter, reporter, reporterDeposit, {from: reporter})

      await time.increase(60);
      await staking.executeDeposit('1', {from: reporter});

      await time.increase(pokePeriod);
    });

    it('swapEthToPipt should work properly', async () => {
      await this.checkWeights(pool, balancerTokens, [
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
      ]);

      const newWeights = [
        ether(8.5504593862460114),
        ether(1.6384501691271029),
        ether(4.7137743219161787),
        ether(0.0719481313563952),
        ether(3.4265860335924222),
        ether(0.11677658796057875),
        ether(2.60023151549259805),
        ether(28.881773854308712),
      ];

      let res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      await this.checkWeights(pool, balancerTokens, newWeights);

      await time.increase(pokePeriod);
      res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      await this.checkWeights(pool, balancerTokens, newWeights);

      let newTokenPrice = mulScalarBN(await oracle.assetPrices(balancerTokens[0].address), ether(1.1));
      await oracle.setPrice(balancerTokens[0].address, newTokenPrice);

      res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 0);

      await time.increase(pokePeriod);

      res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      await this.checkWeights(pool, balancerTokens, [
        ether(9.24736685541669665),
        ether(1.6109022604212159),
        ether(4.63451977568272055),
        ether(0.0707384390560056),
        ether(3.36897349156646525),
        ether(0.11481317714422365),
        ether(2.5565127977966414),
        ether(28.3961732029160303),
      ]);

      newTokenPrice = mulScalarBN(await oracle.assetPrices(balancerTokens[0].address), ether(2));
      await oracle.setPrice(balancerTokens[0].address, newTokenPrice);

      await time.increase(pokePeriod);

      res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      await this.checkWeights(pool, balancerTokens, [
        ether(15.60806386211787435),
        ether(1.3594716068583721),
        ether(3.91116096939167945),
        ether(0.0596975383130789),
        ether(2.843141957504949),
        ether(0.09689306313342665),
        ether(2.15749064767332515),
        ether(23.9640803550072936),
      ]);

      newTokenPrice = mulScalarBN(await oracle.assetPrices(balancerTokens[7].address), ether(0.5));
      await oracle.setPrice(balancerTokens[7].address, newTokenPrice);

      await time.increase(pokePeriod);

      res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      await this.checkWeights(pool, balancerTokens, [
        ether(20.5272244157643101),
        ether(1.7879334046404201),
        ether(5.1438333193741365),
        ether(0.0785122854984897),
        ether(3.73920900908335655),
        ether(0.127430645392092),
        ether(2.83746242268985995),
        ether(15.75839449755733425),
      ]);
    });
  });
});
