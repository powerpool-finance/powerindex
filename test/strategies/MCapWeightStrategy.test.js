const fs = require('fs');

const { expectRevert, time, constants } = require('@openzeppelin/test-helpers');
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

WETH.numberFormat = 'String';
MockERC20.numberFormat = 'String';
UniswapV2Pair.numberFormat = 'String';
UniswapV2Router02.numberFormat = 'String';
MCapWeightStrategy.numberFormat = 'String';
PowerIndexPool.numberFormat = 'String';

const { web3 } = PowerIndexPoolFactory;
const { toBN } = web3.utils;

function ether(val) {
  return web3.utils.toWei(val.toString(), 'ether').toString();
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

function subBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .sub(toBN(bn2.toString(10)))
    .toString(10);
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

function isBNHigher(bn1, bn2) {
  return toBN(bn1.toString(10)).gt(toBN(bn2.toString(10)));
}

function assertEqualWithAccuracy(bn1, bn2, accuracyPercentWei) {
  bn1 = toBN(bn1.toString(10));
  bn2 = toBN(bn2.toString(10));
  const bn1GreaterThenBn2 = bn1.gt(bn2);
  let diff = bn1GreaterThenBn2 ? bn1.sub(bn2) : bn2.sub(bn1);
  let diffPercent = divScalarBN(diff, bn1);
  const lowerThenAccurancy = toBN(diffPercent).lte(toBN(accuracyPercentWei));
  assert.equal(lowerThenAccurancy, true, 'diffPercent is ' + web3.utils.fromWei(diffPercent, 'ether'));
}

describe.only('MCapWeightStrategy', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const swapFee = ether('0.0001');
  const communitySwapFee = ether('0.001');
  const communityJoinFee = ether('0.001');
  const communityExitFee = ether('0.001');

  const poolsData = JSON.parse(fs.readFileSync('data/poolsData.json', { encoding: 'utf8' }));

  let minter, bob, feeManager, feeReceiver, permanentVotingPower;
  before(async function () {
    [minter, bob, feeManager, feeReceiver, permanentVotingPower] = await web3.eth.getAccounts();
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
      const minWeightPerSecond = ether('0.00000001');
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
  });

  describe('Swaps with Uniswap mainnet values', () => {
    let cvp, tokens, balancerTokens, pairs, bPoolBalances, pool, poolController, weightStrategy, oracle;

    const tokenBySymbol = {};
    const pokePeriod = 60 * 60 * 24;

    beforeEach(async () => {
      oracle = await MockOracle.new();
      tokens = [];
      balancerTokens = [];
      pairs = [];
      bPoolBalances = [];

      for (let i = 0; i < poolsData.length; i++) {
        const token = await MockERC20.new(poolsData[i].tokenSymbol, poolsData[i].tokenSymbol, poolsData[i].tokenDecimals, ether('10000000000'));

        console.log('token.address', token.address, 'poolsData.oraclePrice', poolsData[i].oraclePrice);
        await oracle.setPrice(token.address, poolsData[i].oraclePrice);
        tokens.push(token);
        bPoolBalances.push(poolsData[i].balancerBalance);
        if (poolsData[i].tokenSymbol === 'CVP') {
          cvp = token;
        }

        tokenBySymbol[poolsData[i].tokenSymbol] = {
          token,
        };
      }

      balancerTokens =  tokens.filter((t, i) => poolsData[i].balancerBalance !== '0');

      pool = await this.makePowerIndexPool(balancerTokens, bPoolBalances.filter(b => b !== '0'));
      poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);
      await pool.setController(poolController.address);
      weightStrategy = await MCapWeightStrategy.new(oracle.address, pokePeriod);
      await weightStrategy.addPool(pool.address, poolController.address);
      await poolController.setWeightsStrategy(weightStrategy.address);

      await time.increase(12 * 60 * 60);
    });

    it('swapEthToPipt should work properly', async () => {
      const weights = [
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
      ];

      for (let i = 0; i < weights.length; i++) {
         const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
         assert.equal(dw.targetDenorm, weights[i]);
      }

      let res = await weightStrategy.poke();
      assert.equal(res.logs.length, 8);

      for (let i = 0; i < weights.length; i++) {
        const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
        assert.equal(dw.targetDenorm, weights[i]);
      }

      await time.increase(pokePeriod);
      res = await weightStrategy.poke();
      assert.equal(res.logs.length, 8);

      for (let i = 0; i < weights.length; i++) {
        const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
        assert.equal(dw.targetDenorm, weights[i]);
      }

      const token0Price = await oracle.assetPrices(balancerTokens[0].address);
      const newTokenPrice = mulScalarBN(token0Price, ether(1.1));
      await oracle.setPrice(balancerTokens[0].address, newTokenPrice);

      res = await weightStrategy.poke();
      assert.equal(res.logs.length, 0);
      await time.increase(pokePeriod);

      res = await weightStrategy.poke();
      assert.equal(res.logs.length, 8);

      const newWeights = [
        ether(6.875),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
        ether(6.25),
      ];

      for (let i = 0; i < weights.length; i++) {
        const dw = await pool.getDynamicWeightSettings(balancerTokens[i].address);
        assert.equal(dw.targetDenorm, newWeights[i]);
      }
    });
  });
});
