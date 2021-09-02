const { expectRevert, constants, ether: ozEther } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;

const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const ProxyFactory = artifacts.require('ProxyFactory');
const MockERC20 = artifacts.require('MockERC20');
const MockCvp = artifacts.require('MockCvp');
const WETH = artifacts.require('MockWETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');

const _ = require('lodash');

PowerIndexPool.numberFormat = 'String';

const { web3 } = PowerIndexPoolFactory;

function ether(v) {
  return ozEther(v.toString()).toString(10);
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

describe('PowerIndexPool Unit', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const name = 'My Pool';
  const symbol = 'MP';
  const balances = [ether('100'), ether('200')].map(w => w.toString());
  const targetWeights = [ether('25'), ether('15')].map(w => w.toString());
  let fromTimestamps;
  let targetTimestamps;
  const swapFee = ether('0.01');
  const communitySwapFee = ether('0.05');
  const communityJoinFee = ether('0.04');
  const communityExitFee = ether('0.07');
  const minWeightPerSecond = ether('0.00000001');
  const maxWeightPerSecond = ether('0.1');

  let tokens;
  let pool;
  let fromWeights;

  let controller, alice, communityWallet;
  before(async function () {
    [controller, alice, , communityWallet] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();

    const proxyFactory = await ProxyFactory.new();
    const impl = await PowerIndexPool.new();
    this.bFactory = await PowerIndexPoolFactory.new(
      proxyFactory.address,
      impl.address,
      zeroAddress,
      { from: controller }
    );
    this.bActions = await PowerIndexPoolActions.new({ from: controller });
    this.bExchange = await ExchangeProxy.new(this.weth.address, { from: controller });

    this.token1 = await MockCvp.new();
    this.token2 = await MockERC20.new('My Token 2', 'MT2', '18', ether('1000000'));
    tokens = [this.token1.address, this.token2.address];

    fromTimestamps = [await getTimestamp(100), await getTimestamp(100)].map(w => w.toString());
    targetTimestamps = [await getTimestamp(11000), await getTimestamp(11000)].map(w => w.toString());

    await this.token1.approve(this.bActions.address, balances[0]);
    await this.token2.approve(this.bActions.address, balances[1]);

    const res = await this.bActions.create(
      this.bFactory.address,
      name,
      symbol,
      {
        minWeightPerSecond,
        maxWeightPerSecond,
        swapFee,
        communitySwapFee,
        communityJoinFee,
        communityExitFee,
        communityFeeReceiver: communityWallet,
        finalize: true,
      },
      tokens.map((t, i) => ({
        token: t,
        balance: balances[i],
        targetDenorm: targetWeights[i],
        fromTimestamp: fromTimestamps[i],
        targetTimestamp: targetTimestamps[i],
      })),
    );

    const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
    pool = await PowerIndexPool.at(logNewPool.args.pool);
    fromWeights = [await pool.MIN_WEIGHT(), await pool.MIN_WEIGHT()];
  });

  it('should set name and symbol for new pool', async () => {
    assert.equal(await pool.name(), name);
    assert.equal(await pool.symbol(), symbol);
    assert.equal(await pool.decimals(), '18');
    assert.sameMembers(await pool.getCurrentTokens(), tokens);
    assert.deepEqual(
      _.pick(await pool.getDynamicWeightSettings(tokens[0]), [
        'fromTimestamp',
        'targetTimestamp',
        'fromDenorm',
        'targetDenorm',
      ]),
      {
        fromTimestamp: fromTimestamps[0],
        targetTimestamp: targetTimestamps[0],
        fromDenorm: await pool.MIN_WEIGHT(),
        targetDenorm: targetWeights[0],
      },
    );
    assert.equal((await pool.getDenormalizedWeight(tokens[0])).toString(), await pool.MIN_WEIGHT());
    assert.equal((await pool.getDenormalizedWeight(tokens[1])).toString(), await pool.MIN_WEIGHT());
    assert.equal((await pool.getSwapFee()).toString(), swapFee.toString());
    const {
      communitySwapFee: _communitySwapFee,
      communityJoinFee: _communityJoinFee,
      communityExitFee: _communityExitFee,
      communityFeeReceiver: _communityFeeReceiver,
    } = await pool.getCommunityFee();
    assert.equal(_communitySwapFee.toString(), communitySwapFee.toString());
    assert.equal(_communityJoinFee.toString(), communityJoinFee.toString());
    assert.equal(_communityExitFee.toString(), communityExitFee.toString());
    assert.equal(_communityFeeReceiver, communityWallet);
  });

  describe('setDynamicWeight', async () => {
    it('setDynamicWeight should revert for incorrect values', async () => {
      await expectRevert(
        pool.setDynamicWeight(tokens[0], ether('40'), '1', '2', { from: controller }),
        'CANT_SET_PAST_TIMESTAMP',
      );
      await expectRevert(
        pool.setDynamicWeight(tokens[0], ether('40'), fromTimestamps[0], parseInt(fromTimestamps[0]) + 100, {
          from: controller,
        }),
        'MAX_WEIGHT_PER_SECOND'
      );
      await expectRevert(
        pool.setDynamicWeight(tokens[0], parseInt(fromWeights[0]) + 10, fromTimestamps[0], targetTimestamps[0], {
          from: controller,
        }),
        'MIN_WEIGHT_PER_SECOND'
      );
      await expectRevert(
        pool.setDynamicWeight(tokens[0], ether('40'), targetTimestamps[0], fromTimestamps[0], { from: controller }),
        'TIMESTAMP_INCORRECT_DELTA'
      );
      await expectRevert(
        pool.setDynamicWeight(tokens[0], ether('40'), targetTimestamps[0], targetTimestamps[0], { from: controller }),
        'TIMESTAMP_INCORRECT_DELTA'
      );
      await expectRevert(
        pool.setDynamicWeight(tokens[0], ether('51'), fromTimestamps[0], targetTimestamps[0], { from: controller }),
        'TARGET_WEIGHT_BOUNDS',
      );
      await expectRevert(
        pool.setDynamicWeight(tokens[0], ether('45'), fromTimestamps[0], targetTimestamps[0], { from: controller }),
        'MAX_TARGET_TOTAL_WEIGHT'
      );
      await expectRevert(
        pool.setDynamicWeight(tokens[0], ether('10'), fromTimestamps[0], targetTimestamps[0], { from: alice }),
        'NOT_CONTROLLER'
      );
    });
  });

  describe('disabled functions', async () => {
    it('original bind should be disabled in controller', async () => {
      const poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);
      await pool.setController(poolController.address);

      const bindSig = pool.contract._jsonInterface.filter(item => item.name === 'bind' && item.inputs.length === 5)[0]
        .signature;
      const bindArgs = web3.eth.abi.encodeParameters(
        ['address', 'uint', 'uint', 'uint', 'uint'],
        [this.token1.address, balances[0], targetWeights[0], fromTimestamps[0], targetWeights[0]],
      );
      await expectRevert(
        poolController.callPool(bindSig, bindArgs, { from: controller }),
        'SIGNATURE_NOT_ALLOWED',
      );
    });
    it('original unbind should be disabled in controller', async () => {
      const poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);
      await pool.setController(poolController.address);

      const unbindSig = pool.contract._jsonInterface.filter(item => item.name === 'unbind')[0].signature;
      const unbindArgs = web3.eth.abi.encodeParameters(['address'], [this.token1.address]);
      await expectRevert(
        poolController.callPool(unbindSig, unbindArgs, { from: controller }),
        'SIGNATURE_NOT_ALLOWED',
      );
    });
  });

  describe('setWeightPerSecondBounds', async () => {
    it('should correctly set by controller', async () => {
      await pool.setWeightPerSecondBounds(ether('0.00000002'), ether('0.2'), { from: controller });
      assert.deepEqual(_.pick(await pool.getWeightPerSecondBounds(), ['minWeightPerSecond', 'maxWeightPerSecond']), {
        minWeightPerSecond: ether('0.00000002').toString(),
        maxWeightPerSecond: ether('0.2').toString(),
      });
    });
    it('should revert for non-controller', async () => {
      await expectRevert(
        pool.setWeightPerSecondBounds(ether('0.00000002'), ether('0.2'), { from: alice }),
        'NOT_CONTROLLER',
      );
    });
  });

  describe('getNumTokens()', async () => {
    it('should return a number of bound tokens', async () => {
      assert.equal(await pool.getNumTokens(), 2);
    });
  });

  describe('getWrapper()', async () => {
    it('should return 0 wrapper by default', async () => {
      assert.equal(await pool.getWrapper(), constants.ZERO_ADDRESS);
    });

    it('should return a wrapper address when the wrapper is bound', async () => {
      await pool.setWrapper(alice, true, { from: controller})
      assert.equal(await pool.getWrapper(), alice);
    });
  });

  describe('getWrapperMode()', async () => {
    it('should return no wrapper mode by default', async () => {
      assert.equal(await pool.getWrapperMode(), false);
    });

    it('should return a true when the wrapper is explicitly set', async () => {
      await pool.setWrapper(alice, true, { from: controller})
      assert.equal(await pool.getWrapperMode(), true);
    });
  });

  describe('getNormalizedWeight()', async () => {
    it('should return normalized weight of the token', async () => {
      assert.equal(await pool.getNormalizedWeight(this.token1.address), ether('0.5'));
      assert.equal(await pool.getNormalizedWeight(this.token2.address), ether('0.5'));
    });
  });

  describe('getSpotPrice()', async () => {
    it('should return spot price for the asset', async () => {
      assert.equal(await pool.getSpotPrice(this.token1.address, this.token2.address), '505050505050505051');
      assert.equal(await pool.getSpotPrice(this.token2.address, this.token1.address), '2020202020202020202');
    });
  });

  describe('getSpotPriceSansFee()', async () => {
    it('should return spot price sans fee for the asset', async () => {
      assert.equal(await pool.getSpotPriceSansFee(this.token1.address, this.token2.address), '500000000000000000');
      assert.equal(await pool.getSpotPriceSansFee(this.token2.address, this.token1.address), '2000000000000000000');
    });
  });

  describe('getSpotPriceSansFee()', async () => {
    it('should return spot price sans fee for the asset', async () => {
      assert.equal(await pool.getSpotPriceSansFee(this.token1.address, this.token2.address), '500000000000000000');
      assert.equal(await pool.getSpotPriceSansFee(this.token2.address, this.token1.address), '2000000000000000000');
    });
  });
});
