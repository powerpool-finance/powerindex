const fs = require('fs');

const { time, expectRevert, constants } = require('@openzeppelin/test-helpers');
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
const MockProxyCall = artifacts.require('MockProxyCall');
const PowerIndexWrapper = artifacts.require('PowerIndexWrapper');
const WrappedPiErc20Factory = artifacts.require('WrappedPiErc20Factory');
const BasicPowerIndexRouterFactory = artifacts.require('MockBasicPowerIndexRouterFactory');
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
const {buildBasicRouterConfig, buildBasicRouterArgs} = require('../helpers/builders');

function ether(val) {
  return web3.utils.toWei(val.toString(), 'ether').toString();
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

function addBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .add(toBN(bn2.toString(10)))
    .toString(10);
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

  let minter, alice, feeManager, permanentVotingPower, uniswapRouter, weightStrategyOwner, reporter, slasher, reservoir;
  before(async function () {
    [minter, alice, feeManager, permanentVotingPower, uniswapRouter, weightStrategyOwner, reporter, slasher, reservoir] = await web3.eth.getAccounts();
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

    this.checkWrappedWeights = async (pool, poolWrapper, balancerTokens, weights) => {
      for (let i = 0; i < weights.length; i++) {
        const piTokenAddress = await poolWrapper.piTokenByUnderlying(balancerTokens[i].address);
        const dw = await pool.getDynamicWeightSettings(piTokenAddress === constants.ZERO_ADDRESS ? balancerTokens[i].address : piTokenAddress);
        assertEqualWithAccuracy(dw.targetDenorm, weights[i]);
      }
    };
  });

  describe('Weights updating', () => {
    let tokens, balancerTokens, bPoolBalances, pool, poolController, weightStrategy, oracle, poke, fastGasOracle, staking, cvpToken;

    const tokenBySymbol = {};
    const pokePeriod = 14 * 60 * 60 * 24;
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

      cvpToken = await MockCvp.new();
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

        await oracle.setPrice(token.address, poolsData[i].oraclePrice);
        const excludeAddresses = await pIteration.map(poolsData[i].excludeBalances, (bal) => {
          const {address} = ethers.Wallet.createRandom();
          token.transfer(address, bal);
          return address;
        });
        await weightStrategy.setExcludeTokenBalances(token.address, excludeAddresses);

        assert.sameMembers(await weightStrategy.getExcludeTokenBalancesList(token.address), excludeAddresses);
        assert.equal(await weightStrategy.getExcludeTokenBalancesLength(token.address), excludeAddresses.length);

        tokens.push(token);
        bPoolBalances.push(poolsData[i].balancerBalance);

        tokenBySymbol[poolsData[i].tokenSymbol] = {
          token,
        };
      }

      balancerTokens = tokens.filter((t, i) => poolsData[i].balancerBalance !== '0');

      pool = await this.makePowerIndexPool(balancerTokens, bPoolBalances.filter(b => b !== '0'));
      poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);
      await pool.setController(poolController.address);
      await weightStrategy.addPool(pool.address, poolController.address, zeroAddress);
      await poolController.setWeightsStrategy(weightStrategy.address);

      await poke.addClient(weightStrategy.address, weightStrategyOwner, true, gwei(300), pokePeriod, pokePeriod * 2, { from: minter });
      await cvpToken.approve(poke.address, ether(30000), { from: minter })
      await poke.addCredit(weightStrategy.address, ether(30000), { from: minter });
      await poke.setBonusPlan(weightStrategy.address, 1,  true, 20, 17520000, 100 * 1000, { from: weightStrategyOwner });

      const slasherDeposit = ether(10000);
      const reporterDeposit = ether(20000);
      await poke.setMinimalDeposit(weightStrategy.address, slasherDeposit, { from: weightStrategyOwner });

      await cvpToken.transfer(reporter, reporterDeposit);
      await cvpToken.approve(staking.address, reporterDeposit, {from: reporter});
      await staking.createUser(reporter, reporter, reporterDeposit, {from: reporter});

      await cvpToken.transfer(slasher, slasherDeposit);
      await cvpToken.approve(staking.address, slasherDeposit, {from: slasher});
      await staking.createUser(slasher, slasher, slasherDeposit, {from: slasher});

      await time.increase(60);
      await staking.executeDeposit('1', {from: reporter});
      await staking.executeDeposit('2', {from: slasher});

      await time.increase(pokePeriod);
    });

    it('should deny poking from a contract', async function() {
      const proxyCall = await MockProxyCall.new();
      await cvpToken.transfer(alice, ether(30000));
      await cvpToken.approve(staking.address, ether(30000), {from: alice});
      await staking.createUser(alice, proxyCall.address, ether(30000), {from: alice});
      await time.increase(60);
      await staking.executeDeposit('3', {from: alice});

      const data = weightStrategy.contract.methods.pokeFromReporter(3, [pool.address], '0x').encodeABI();
      await expectRevert(proxyCall.makeCall(weightStrategy.address, data), 'CONTRACT_CALL');
    });

    it('pools getters should work properly', async () => {
      let poolData = await weightStrategy.poolsData(pool.address);
      assert.equal(poolData.controller, poolController.address);
      assert.equal(poolData.lastWeightsUpdate, '0');
      assert.equal(poolData.active, true);

      assert.sameMembers(await weightStrategy.getPoolsList(), [pool.address]);
      assert.sameMembers(await weightStrategy.getActivePoolsList(), [pool.address]);
      assert.equal(await weightStrategy.getPoolsLength(), '1');

      await expectRevert(weightStrategy.addPool(pool.address, poolController.address, zeroAddress), 'ALREADY_EXIST');
      await expectRevert(weightStrategy.addPool(reservoir, reservoir, zeroAddress, {from: reporter}), 'Ownable');

      await weightStrategy.addPool(reservoir, reservoir, zeroAddress);
      assert.sameMembers(await weightStrategy.getPoolsList(), [pool.address, reservoir]);
      assert.sameMembers(await weightStrategy.getActivePoolsList(), [pool.address, reservoir]);
      assert.equal(await weightStrategy.getPoolsLength(), '2');

      await expectRevert(weightStrategy.setPool(reservoir, reservoir, zeroAddress, false, {from: reporter}), 'Ownable');
      await weightStrategy.setPool(reservoir, reservoir, zeroAddress, false);
      assert.sameMembers(await weightStrategy.getPoolsList(), [pool.address, reservoir]);
      assert.sameMembers(await weightStrategy.getActivePoolsList(), [pool.address]);
      assert.equal(await weightStrategy.getPoolsLength(), '2');

      poolData = await weightStrategy.poolsData(reservoir);
      assert.equal(poolData.controller, reservoir);
      assert.equal(poolData.lastWeightsUpdate, '0');
      assert.equal(poolData.active, false);

      await weightStrategy.setPool(reservoir, reservoir, zeroAddress, true);
      assert.sameMembers(await weightStrategy.getActivePoolsList(), [pool.address, reservoir]);

      await weightStrategy.setPool(reservoir, reservoir, zeroAddress, false);
      await weightStrategy.setPool(pool.address, poolController.address, zeroAddress, false);
      assert.sameMembers(await weightStrategy.getActivePoolsList(), []);
    });

    it('pausePool should work properly', async () => {
      const normalizedBefore = [
        ether('0.125'),
        ether('0.125'),
        ether('0.125'),
        ether('0.125'),
        ether('0.125'),
        ether('0.125'),
        ether('0.125'),
        ether('0.125'),
      ];
      for (let i = 0; i < balancerTokens.length; i++) {
        assert.equal(await pool.getNormalizedWeight(balancerTokens[i].address), normalizedBefore[i]);
      }

      let res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      const targetWeights = [];
      let targetWeightsSum = '0';
      for (let i = 0; i < balancerTokens.length; i++) {
        const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
        targetWeights[i] = dw.targetDenorm;
        targetWeightsSum = addBN(targetWeightsSum, dw.targetDenorm);
      }

      const normalizedTargetWeights = [
        ether('0.17100918772492023'),
        ether('0.03276900338254206'),
        ether('0.094275486438323576'),
        ether('0.001438962627127906'),
        ether('0.068531720671848446'),
        ether('0.002335531759211577'),
        ether('0.052004630309851963'),
        ether('0.577635477086174242'),
      ];
      for (let i = 0; i < balancerTokens.length; i++) {
        const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
        assertEqualWithAccuracy(divScalarBN(dw.targetDenorm, targetWeightsSum), normalizedTargetWeights[i]);
      }

      await time.increase(pokePeriod / 2);

      const normalizedCurrentWeights = [
        ether('0.140336362097930646'),
        ether('0.094256402237858482'),
        ether('0.114758518057697806'),
        ether('0.083813078342627977'),
        ether('0.106177281720318905'),
        ether('0.084111934061128623'),
        ether('0.100668263744773599'),
        ether('0.275878159737663962'),
      ];
      const currentWeights = [];
      for (let i = 0; i < balancerTokens.length; i++) {
        const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
        assert.equal(targetWeights[i], dw.targetDenorm);
        currentWeights[i] = await pool.getDenormalizedWeight(balancerTokens[i].address);
        assertEqualWithAccuracy(await pool.getNormalizedWeight(balancerTokens[i].address), normalizedCurrentWeights[i], '5000000000000');
      }

      await weightStrategy.pausePool(pool.address);

      for (let i = 0; i < balancerTokens.length; i++) {
        const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
        assert.notEqual(targetWeights[i], dw.targetDenorm);
        assertEqualWithAccuracy(dw.targetDenorm, currentWeights[i], '5000000000000');
        assertEqualWithAccuracy(await pool.getNormalizedWeight(balancerTokens[i].address), normalizedCurrentWeights[i], '5000000000000');
      }

      await time.increase(pokePeriod / 2);

      for (let i = 0; i < balancerTokens.length; i++) {
        assertEqualWithAccuracy(await pool.getDenormalizedWeight(balancerTokens[i].address), currentWeights[i], '5000000000000');
        assertEqualWithAccuracy(await pool.getNormalizedWeight(balancerTokens[i].address), normalizedCurrentWeights[i], '5000000000000');
      }
    });

    it('pokeFromReporter and pokeFromSlasher should work properly', async () => {
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
        ether(4.27522969312300575),
        ether(0.8192250845635515),
        ether(2.3568871609580894),
        ether(0.03597406567819765),
        ether(1.71329301679621115),
        ether(0.058388293980289425),
        ether(1.300115757746299075),
        ether(14.44088692715435605),
      ];

      await expectRevert(
        weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: minter}),
        'INVALID_POKER_KEY'
      );

      await expectRevert(
        weightStrategy.pokeFromReporter('2', [pool.address], compensationOpts, {from: slasher}),
        'NOT_HDH'
      );

      await expectRevert(
        weightStrategy.pokeFromSlasher('2', [pool.address], compensationOpts, {from: minter}),
        'INVALID_POKER_KEY'
      );

      let res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      let poolData = await weightStrategy.poolsData(pool.address);
      assert.equal(poolData.lastWeightsUpdate, await web3.eth.getBlock(res.receipt.blockNumber).then(b => b.timestamp));

      await this.checkWeights(pool, balancerTokens, newWeights);

      await time.increase(pokePeriod);

      await expectRevert(
        weightStrategy.pokeFromSlasher('2', [pool.address], compensationOpts, {from: slasher}),
        'MAX_INTERVAL_NOT_REACHED'
      );

      await weightStrategy.setPool(pool.address, poolController.address, zeroAddress, false);

      await expectRevert(
        weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter}),
        'NOT_ACTIVE'
      );

      await weightStrategy.setPool(pool.address, poolController.address, zeroAddress, true);

      res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      poolData = await weightStrategy.poolsData(pool.address);
      assert.equal(poolData.lastWeightsUpdate, await web3.eth.getBlock(res.receipt.blockNumber).then(b => b.timestamp));

      await this.checkWeights(pool, balancerTokens, newWeights);

      let newTokenPrice = mulScalarBN(await oracle.assetPrices(balancerTokens[0].address), ether(1.1));
      await oracle.setPrice(balancerTokens[0].address, newTokenPrice);

      await expectRevert(
        weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter}),
        'MIN_INTERVAL_NOT_REACHED'
      );

      await time.increase(pokePeriod * 2);

      res = await weightStrategy.pokeFromSlasher('2', [pool.address], compensationOpts, {from: slasher});
      assert.equal(res.logs.length, 9);

      await this.checkWeights(pool, balancerTokens, [
        ether(4.623683427708348375),
        ether(0.805451130210608),
        ether(2.317259887841360325),
        ether(0.03536921952800285),
        ether(1.684486745783232675),
        ether(0.057406588572111875),
        ether(1.27825639889832075),
        ether(14.1980866014580152),
      ]);

      newTokenPrice = mulScalarBN(await oracle.assetPrices(balancerTokens[0].address), ether(2));
      await oracle.setPrice(balancerTokens[0].address, newTokenPrice);
      await time.increase(pokePeriod);

      res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      await this.checkWeights(pool, balancerTokens, [
        ether(7.804031931058937225),
        ether(0.6797358034291861),
        ether(1.955580484695839775),
        ether(0.0298487691565395),
        ether(1.42157097875247455),
        ether(0.048446531566713375),
        ether(1.078745323836662625),
        ether(11.98204017750364685),
      ]);

      newTokenPrice = mulScalarBN(await oracle.assetPrices(balancerTokens[7].address), ether(0.5));
      await oracle.setPrice(balancerTokens[7].address, newTokenPrice);

      await time.increase(pokePeriod);

      res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      await this.checkWeights(pool, balancerTokens, [
        ether(10.2636122078821551),
        ether(0.8939667023202101),
        ether(2.5719166596870683),
        ether(0.0392561427492449),
        ether(1.869604504541678325),
        ether(0.06371532269604605),
        ether(1.418731211344930025),
        ether(7.879197248778667175),
      ]);
    });

    it('pokeFromReporter and pokeFromSlasher should work properly', async () => {
      const defaultFactoryArguments = buildBasicRouterArgs(web3, buildBasicRouterConfig(
        this.poolRestrictions.address,
        constants.ZERO_ADDRESS,
        constants.ZERO_ADDRESS,
        ether(0),
        '0',
        permanentVotingPower,
        ether(0),
        []
      ));

      const piTokenEthFee = ether(0.0001).toString();
      const poolWrapper = await PowerIndexWrapper.new(pool.address);
      await poolWrapper.setController(poolController.address);

      const piTokenFactory = await WrappedPiErc20Factory.new();
      const routerFactory = await BasicPowerIndexRouterFactory.new();

      await poolController.setPoolWrapper(poolWrapper.address);
      await poolController.setPiTokenFactory(piTokenFactory.address);

      const setWrapperData = pool.contract.methods.setWrapper(poolWrapper.address, true).encodeABI();
      await poolController.callPool(setWrapperData.slice(0, 10), '0x' + setWrapperData.slice(10));

      await poolController.replacePoolTokenWithNewPiToken(balancerTokens[0].address, routerFactory.address, defaultFactoryArguments, 'W T 1', 'WT1', {
        value: piTokenEthFee
      });

      await time.increase(60);

      await poolController.finishReplace();

      await weightStrategy.setPool(pool.address, poolController.address, poolWrapper.address, true);

      await this.checkWrappedWeights(pool, poolWrapper, balancerTokens, [
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
        ether(4.27522969312300575),
        ether(0.8192250845635515),
        ether(2.3568871609580894),
        ether(0.03597406567819765),
        ether(1.71329301679621115),
        ether(0.058388293980289425),
        ether(1.300115757746299075),
        ether(14.44088692715435605),
      ];

      const res = await weightStrategy.pokeFromReporter('1', [pool.address], compensationOpts, {from: reporter});
      assert.equal(res.logs.length, 9);

      const poolData = await weightStrategy.poolsData(pool.address);
      assert.equal(poolData.lastWeightsUpdate, await web3.eth.getBlock(res.receipt.blockNumber).then(b => b.timestamp));

      await this.checkWrappedWeights(pool, poolWrapper, balancerTokens, newWeights);
    });
  });
});
