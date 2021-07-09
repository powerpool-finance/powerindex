const { expectRevert, time, ether: ozEther } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;

const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const MockERC20 = artifacts.require('MockERC20');
const MockCvp = artifacts.require('MockCvp');
const WETH = artifacts.require('MockWETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const ProxyFactory = artifacts.require('ProxyFactory');
const ProxyAdmin = artifacts.require('ProxyAdmin');
const MockPowerIndexPoolV2 = artifacts.require('MockPowerIndexPoolV2');

const _ = require('lodash');
const pIteration = require('p-iteration');

PowerIndexPool.numberFormat = 'String';
MockERC20.numberFormat = 'String';
MockCvp.numberFormat = 'String';
MockPowerIndexPoolV2.numberFormat = 'String';

const { web3 } = PowerIndexPoolFactory;
const { toBN } = web3.utils;

function mulScalarBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .mul(toBN(bn2.toString(10)))
    .div(toBN(ether('1').toString(10)))
    .toString(10);
}
function divScalarBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .mul(toBN(ether('1').toString(10)))
    .div(toBN(bn2.toString(10)))
    .toString(10);
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
function mulBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .mul(toBN(bn2.toString(10)))
    .toString(10);
}
function isBNHigherOrEqual(bn1, bn2) {
  return toBN(bn1.toString(10)).gte(toBN(bn2.toString(10)));
}
function isBNHigher(bn1, bn2) {
  return toBN(bn1.toString(10)).gt(toBN(bn2.toString(10)));
}

function assertEqualWithAccuracy(bn1, bn2, accuracyPercentWei, message = '') {
  bn1 = toBN(bn1.toString(10));
  bn2 = toBN(bn2.toString(10));
  const bn1GreaterThenBn2 = bn1.gt(bn2);
  let diff = bn1GreaterThenBn2 ? bn1.sub(bn2) : bn2.sub(bn1);
  let diffPercent = divScalarBN(diff, bn1);
  assert.equal(toBN(diffPercent).lte(toBN(accuracyPercentWei)), true, message);
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

function ether(v) {
  return ozEther(v).toString(10);
}

describe('PowerIndexPool', () => {
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

  const gasPrice = 100 * 10**9;

  let tokens;
  let pool;
  let proxyAdmin;

  let controller, alice, communityWallet;
  before(async function () {
    [controller, alice, , communityWallet] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();

    proxyAdmin = await ProxyAdmin.new();
    const proxyFactory = await ProxyFactory.new();
    const impl = await PowerIndexPool.new();
    this.bFactory = await PowerIndexPoolFactory.new(
      proxyFactory.address,
      impl.address,
      proxyAdmin.address,
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

    this.getTokensToJoinPoolAndApprove = async (_pool, amountToMint) => {
      const poolTotalSupply = await _pool.totalSupply();
      const ratio = divScalarBN(amountToMint, poolTotalSupply);
      const token1Amount = mulScalarBN(ratio, await _pool.getBalance(this.token1.address));
      const token2Amount = mulScalarBN(ratio, await _pool.getBalance(this.token2.address));
      await this.token1.approve(this.bActions.address, token1Amount);
      await this.token2.approve(this.bActions.address, token2Amount);
      return [token1Amount, token2Amount];
    };
    this.calcOutGivenIn = async (_tokenIn, _tokenOut, amountIn) => {
      return pool.calcOutGivenIn(
        await pool.getBalance(_tokenIn),
        await getDenormWeight(_tokenIn, await getTimestamp(1)),
        await pool.getBalance(_tokenOut),
        await getDenormWeight(_tokenOut, await getTimestamp(1)),
        amountIn,
        swapFee,
      );
    };
    this.calcPoolOutGivenSingleIn = async (_tokenIn, _amountIn) => {
      return pool.calcPoolOutGivenSingleIn(
        await pool.getBalance(_tokenIn),
        await pool.getDenormalizedWeight(_tokenIn),
        await pool.totalSupply(),
        await pool.getTotalDenormalizedWeight(),
        _amountIn,
        swapFee,
      );
    };
    this.calcPoolInGivenSingleOut = async (_tokenOut, _amountOut) => {
      return pool.calcPoolInGivenSingleOut(
        await pool.getBalance(_tokenOut),
        await pool.getDenormalizedWeight(_tokenOut),
        await pool.totalSupply(),
        await pool.getTotalDenormalizedWeight(),
        _amountOut,
        swapFee,
      );
    };
    this.joinswapExternAmountIn = async (_token, _amountIn) => {
      const amountInFee = mulScalarBN(_amountIn, communitySwapFee);
      const amountInAfterFee = subBN(_amountIn, amountInFee);
      let poolAmountOut = await this.calcPoolOutGivenSingleIn(_token.address, amountInAfterFee);
      // console.log('joinswapExternAmountIn', web3.utils.fromWei(_amountIn, 'ether'), '=>', web3.utils.fromWei(poolAmountOut));

      await _token.transfer(alice, _amountIn);
      await _token.approve(pool.address, _amountIn, { from: alice });
      await pool.joinswapExternAmountIn(_token.address, _amountIn, poolAmountOut, { from: alice });
    };
    this.joinPool = async (tokens, _token1In) => {
      const poolOutAmount = divScalarBN(
        mulScalarBN(_token1In, await pool.totalSupply()),
        await pool.getBalance(tokens[0]),
      );
      let ratio = divScalarBN(poolOutAmount, await pool.totalSupply());
      const amounts = [];
      await pIteration.forEachSeries(tokens, async (t) => {
        const tokenInAmount = mulScalarBN(mulScalarBN(ratio, await pool.getBalance(t)), ether('1.001'));
        const token = await MockERC20.at(t);
        await token.transfer(alice, tokenInAmount);
        await token.approve(pool.address, tokenInAmount, { from: alice });
        amounts.push(tokenInAmount);
      });
      return await pool.joinPool(poolOutAmount, amounts, { from: alice });
    };

    this.exitswapExternAmountOut = async (_token, _amountOut) => {
      let poolAmountIn = await this.calcPoolInGivenSingleOut(_token.address, _amountOut);
      // console.log('exitswapExternAmountOut', web3.utils.fromWei(poolAmountIn, 'ether'), '=>', web3.utils.fromWei(_amountOut));
      if (isBNHigher(poolAmountIn, await pool.balanceOf(alice))) {
        await pool.transfer(alice, poolAmountIn);
      }
      await pool.approve(pool.address, poolAmountIn, { from: alice });
      await pool.exitswapExternAmountOut(_token.address, _amountOut, poolAmountIn, { from: alice });
    };

    this.multihopBatchSwapExactIn = async (_tokenFrom, _tokenTo, amountToSwap) => {
      const amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
      const amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

      (await MockERC20.at(_tokenFrom)).transfer(alice, amountToSwap);
      (await MockERC20.at(_tokenFrom)).approve(this.bExchange.address, amountToSwap, { from: alice });

      const expectedSwapOut = await this.calcOutGivenIn(_tokenFrom, _tokenTo, amountAfterCommunitySwapFee);
      // console.log('expectedSwapOut', web3.utils.fromWei(expectedSwapOut, 'ether'));
      // console.log('await pool.getBalance(_tokenFrom)', await pool.getBalance(_tokenFrom), 'amountToSwap', amountToSwap);
      // console.log('await pool.getBalance(_tokenTo)', await pool.getBalance(_tokenTo), 'expectedSwapOut', expectedSwapOut);
      // console.log('await getDenormWeight(_tokenFrom, await getTimestamp(1))', await getDenormWeight(_tokenFrom, await getTimestamp(1)));
      // console.log('await getDenormWeight(_tokenTo, await getTimestamp(1))', await getDenormWeight(_tokenTo, await getTimestamp(1)));
      const price = (
        await pool.calcSpotPrice(
          addBN(await pool.getBalance(_tokenFrom), amountToSwap),
          await getDenormWeight(_tokenFrom, await getTimestamp(1)),
          subBN(await pool.getBalance(_tokenTo), expectedSwapOut),
          await getDenormWeight(_tokenTo, await getTimestamp(1)),
          swapFee,
        )
      );

      await this.bExchange.multihopBatchSwapExactIn(
        [
          [
            {
              pool: pool.address,
              tokenIn: _tokenFrom,
              tokenOut: _tokenTo,
              swapAmount: amountToSwap,
              limitReturnAmount: mulScalarBN(expectedSwapOut, ether('0.995')),
              maxPrice: mulScalarBN(price, ether('1.005')),
            },
          ],
        ],
        _tokenFrom,
        _tokenTo,
        amountToSwap,
        mulScalarBN(expectedSwapOut, ether('0.995')),
        { from: alice },
      );
    };
  });

  describe('test swap after time spent', async () => {
    let amountToSwap, amountCommunitySwapFee;

    beforeEach(async () => {
      amountToSwap = ether('1').toString(10);
      await this.token1.transfer(alice, amountToSwap);
      await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
      await this.token1.approve(this.bExchange.address, amountToSwap, { from: alice });
      await this.token1.approve(this.bActions.address, amountToSwap, { from: alice });
      await this.token2.approve(this.bActions.address, mulScalarBN(amountToSwap, ether('2')), { from: alice });

      amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
    });

    for (let sec = 10; sec < 13000; sec += 1000) {
      it(`should correctly swap by multihopBatchSwapExactIn after ${sec} seconds pass`, async () => {
        await time.increase(sec);

        await assertEqualWithAccuracy(
          await getDenormWeight(tokens[0]),
          await pool.getDenormalizedWeight(tokens[0]),
          ether('0.0000000001'),
        );
        await assertEqualWithAccuracy(
          await getDenormWeight(tokens[1]),
          await pool.getDenormalizedWeight(tokens[1]),
          ether('0.0000000001'),
        );

        const etherWeights = await pIteration.map(tokens, async t => {
          return web3.utils.fromWei(await pool.getDenormalizedWeight(t), 'ether');
        });
        console.log('            current weights', etherWeights.join(', '));

        await this.multihopBatchSwapExactIn(tokens[0], tokens[1], amountToSwap);

        assert.equal(await this.token1.balanceOf(communityWallet), amountCommunitySwapFee.toString());
      });
    }
  });

  it('gulp should work properly with bound token', async () => {
    const excessBalance = ether('1');
    const poolMappingBalance = await pool.getBalance(this.token1.address);
    const poolActualBalance = await this.token1.balanceOf(pool.address);
    const pvpBalance = await this.token1.balanceOf(communityWallet);

    await this.token1.transfer(pool.address, excessBalance);

    assert.equal(poolMappingBalance, await pool.getBalance(this.token1.address));
    assert.equal(addBN(poolActualBalance, excessBalance), await this.token1.balanceOf(pool.address));

    await pool.gulp(this.token1.address);

    assert.equal(addBN(poolMappingBalance, excessBalance), await pool.getBalance(this.token1.address));
    assert.equal(addBN(poolActualBalance, excessBalance), await this.token1.balanceOf(pool.address));
    assert.equal(pvpBalance, await this.token1.balanceOf(communityWallet));

    await pool.gulp(this.token1.address);

    assert.equal(addBN(poolMappingBalance, excessBalance), await pool.getBalance(this.token1.address));
    assert.equal(addBN(poolActualBalance, excessBalance), await this.token1.balanceOf(pool.address));
  });

  it('gulp should work properly with not bound token', async () => {
    const newToken = await MockERC20.new('My Token 2', 'MT2', '18', ether('1000000'));

    const excessBalance = ether('1');
    assert.equal(await pool.isBound(newToken.address), false);
    const poolActualBalance = await newToken.balanceOf(pool.address);
    const pvpBalance = await newToken.balanceOf(communityWallet);

    await newToken.transfer(pool.address, excessBalance);

    assert.equal(addBN(poolActualBalance, excessBalance), await newToken.balanceOf(pool.address));

    await pool.gulp(newToken.address);

    assert.equal(poolActualBalance, await newToken.balanceOf(pool.address));
    assert.equal(addBN(pvpBalance, excessBalance), await newToken.balanceOf(communityWallet));

    await pool.gulp(newToken.address);

    assert.equal(poolActualBalance, await newToken.balanceOf(pool.address));
  });

  it('gulp should support wrapper mode', async () => {
    await pool.setWrapper(alice, true);

    await expectRevert(pool.gulp(this.token1.address), 'ONLY_WRAPPER');
  });

  it('gulp should support wrapper mode', async () => {
    await pool.setWrapper(alice, true);

    await expectRevert(pool.gulp(this.token1.address), 'ONLY_WRAPPER');
  });

  it('proxy upgrade should work properly', async () => {
    const newImpl = await MockPowerIndexPoolV2.new();

    await expectRevert(proxyAdmin.upgrade(pool.address, newImpl.address, {from: alice}), 'Ownable: caller is not the owner');
    await proxyAdmin.upgrade(pool.address, newImpl.address, {from: controller});

    pool = await MockPowerIndexPoolV2.at(pool.address);
    assert.equal(await pool.test(), '0');
    await pool.setTest('1');
    assert.equal(await pool.test(), '1');
  });

  describe('restoring ratio after weight changing', () => {
    let amountToSwapBefore,
      amountToSwapAfter,
      poolAmountOutToken1Before,
      poolAmountOutToken1After,
      poolAmountOutToken2Before,
      poolAmountOutToken2After;
    let amountToSwap,
      amountCommunitySwapFee,
      amountAfterCommunitySwapFee,
      token1BalanceNeedInWithFee,
      token2BalanceNeedInWithFee;
    beforeEach(async () => {
      amountToSwap = ether('0.1').toString(10);
      amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
      amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

      amountToSwapBefore = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
      poolAmountOutToken1Before = await this.calcPoolOutGivenSingleIn(tokens[0], ether('1'));
      poolAmountOutToken2Before = await this.calcPoolOutGivenSingleIn(tokens[1], ether('1'));
      assert.equal(amountToSwapBefore, ether('0.1879232581756858'));
      assert.equal(poolAmountOutToken1Before, ether('0.4962685874475485'));
      assert.equal(poolAmountOutToken2Before, ether('0.248441384384303'));

      await time.increase(11000);
      amountToSwapAfter = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
      poolAmountOutToken1After = await this.calcPoolOutGivenSingleIn(tokens[0], ether('1'));
      poolAmountOutToken2After = await this.calcPoolOutGivenSingleIn(tokens[1], ether('1'));
      assert.equal(amountToSwapAfter, ether('0.3131073224019748'));
      assert.equal(poolAmountOutToken1After, ether('0.62149842727433'));
      assert.equal(poolAmountOutToken2After, ether('0.1860395830487343'));

      await this.token1.transfer(alice, amountToSwap);
      await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
      await this.token1.approve(this.bExchange.address, amountToSwap, { from: alice });
      await this.token1.approve(this.bActions.address, amountToSwap, { from: alice });
      await this.token2.approve(this.bActions.address, mulScalarBN(amountToSwap, ether('2')), { from: alice });

      [token1BalanceNeedInWithFee, token2BalanceNeedInWithFee] = await needTokensBalanceIn(pool, tokens);
      token2BalanceNeedInWithFee = token2BalanceNeedInWithFee.replace('-', '');
    });

    it('balances ratio should be restored by joinswapExternAmountIn and exitswapExternAmountOut', async () => {
      assert.equal(targetWeights[0], await pool.getDenormalizedWeight(tokens[0]));
      assert.equal(targetWeights[1], await pool.getDenormalizedWeight(tokens[1]));

      await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
      await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
      await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
      await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
      await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));

      await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
      await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
      await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
      await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
      await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));

      const amountToSwapFixed = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
      await assertEqualWithAccuracy(amountToSwapBefore, amountToSwapFixed, ether('0.015'));
    });

    it('balances ratio should be restored by swapExactAmountIn', async () => {
      assert.equal(targetWeights[0], await pool.getDenormalizedWeight(tokens[0]));
      assert.equal(targetWeights[1], await pool.getDenormalizedWeight(tokens[1]));

      await this.multihopBatchSwapExactIn(tokens[0], tokens[1], divScalarBN(token1BalanceNeedInWithFee, ether('5')));
      await this.multihopBatchSwapExactIn(tokens[0], tokens[1], divScalarBN(token1BalanceNeedInWithFee, ether('5')));
      await this.multihopBatchSwapExactIn(tokens[0], tokens[1], divScalarBN(token1BalanceNeedInWithFee, ether('5')));
      await this.multihopBatchSwapExactIn(tokens[0], tokens[1], divScalarBN(token1BalanceNeedInWithFee, ether('4')));

      const amountToSwapFixed = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
      await assertEqualWithAccuracy(amountToSwapBefore, amountToSwapFixed, ether('0.015'));
    });
  });

  describe('adding and removing token', () => {
    this.joinswapTo1Ether = async () => {
      await this.joinswapExternAmountIn(this.token3, ether('0.0005'));
      await this.joinswapExternAmountIn(this.token3, ether('0.0005'));
      await this.joinswapExternAmountIn(this.token3, ether('0.0005'));
      await this.joinswapExternAmountIn(this.token3, ether('0.001'));
      await this.joinswapExternAmountIn(this.token3, ether('0.001'));
      await this.joinswapExternAmountIn(this.token3, ether('0.002'));
      await this.joinswapExternAmountIn(this.token3, ether('0.002'));
      await this.joinswapExternAmountIn(this.token3, ether('0.002'));
      await this.joinswapExternAmountIn(this.token3, ether('0.005'));
      await this.joinswapExternAmountIn(this.token3, ether('0.005'));
      await this.joinswapExternAmountIn(this.token3, ether('0.005'));
      await this.joinswapExternAmountIn(this.token3, ether('0.01'));
      await this.joinswapExternAmountIn(this.token3, ether('0.01'));
      await this.joinswapExternAmountIn(this.token3, ether('0.02'));
      await this.joinswapExternAmountIn(this.token3, ether('0.02'));
      await this.joinswapExternAmountIn(this.token3, ether('0.02'));
      await this.joinswapExternAmountIn(this.token3, ether('0.05'));
      await this.joinswapExternAmountIn(this.token3, ether('0.05'));
      await this.joinswapExternAmountIn(this.token3, ether('0.05'));
      await this.joinswapExternAmountIn(this.token3, ether('0.1'));
      await this.joinswapExternAmountIn(this.token3, ether('0.1'));
      await this.joinswapExternAmountIn(this.token3, ether('0.2'));
      await this.joinswapExternAmountIn(this.token3, ether('0.3'));
      await this.joinswapExternAmountIn(this.token3, ether('0.3'));
      await this.joinswapExternAmountIn(this.token3, ether('0.5'));
      await this.joinswapExternAmountIn(this.token3, ether('0.5'));
      await this.joinswapExternAmountIn(this.token3, ether('1'));
    };

    const initialBalance = ether('0.001');
    const targetWeight = ether('6.25');
    let fromTimestamp, targetTimestamp;

    beforeEach(async () => {
      const newBalances = [ether('18.8').toString(), ether('0.617').toString()];
      const newTargetWeights = [ether('6.25').toString(), ether('6.25').toString()];
      await this.token1.approve(this.bActions.address, newBalances[0]);
      await this.token2.approve(this.bActions.address, newBalances[1]);

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
          balance: newBalances[i],
          targetDenorm: newTargetWeights[i],
          fromTimestamp: fromTimestamps[i],
          targetTimestamp: targetTimestamps[i],
        })),
      );

      const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(
        l => l.event === 'LOG_NEW_POOL',
      )[0];
      pool = await PowerIndexPool.at(logNewPool.args.pool);

      await time.increase(11000);

      const token1BalanceNeedInWithFee = ether('188000');

      await this.joinPool([this.token1.address, this.token2.address], token1BalanceNeedInWithFee);

      fromTimestamp = await getTimestamp(100);
      targetTimestamp = await getTimestamp(11000);

      this.token3 = await MockERC20.new('My Token 3', 'MT3', '18', ether('1000000'));
      await this.token3.approve(pool.address, initialBalance);
      await pool.bind(this.token3.address, initialBalance, targetWeight, fromTimestamp, targetTimestamp);

      const amountSwapOutBeforeIncrease = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeIncrease, ether('0.000014965918562212'));
      const poolAmountOutBeforeIncrease = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeIncrease, ether('0.00007920792'));
    });

    it('adding liquidity right after token adding', async () => {
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), ether('0.000000001'));
      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('0.000014965918562212'));
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('0.00007920792'));

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('0.00000000952634854'));
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('0.000000002534253402'));
    });

    //TODO: use accuracy in asserts for avoid buidler evm incorrect timestamps errors
    it.skip('adding liquidity on 4 seconds spent after token adding', async () => {
      await time.increaseTo(fromTimestamp + 4);
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), ether('0.0022935789812844').toString());

      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('59.340295159811555919').toString());
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('126.2608414287197059').toString());

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('0.469834196398395663').toString());
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('0.125149003262977482').toString());
    });

    it.skip('adding liquidity on 104 seconds spent after token adding', async () => {
      await time.increaseTo(fromTimestamp + 104);
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), ether('0.0596330285133944').toString());

      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('1242.220992324808182353').toString());
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('3273.0415634952126006').toString());

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('1.016151542043268956'));
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('0.281174152972328109'));
    });

    it.skip('adding liquidity on 204 seconds spent after token adding', async () => {
      await time.increaseTo(fromTimestamp + 204);
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), ether('0.1169724780455044'));

      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('2417.657497211382457888'));
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('6401.1934068687173564'));

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('1.562467300275684877'));
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('0.447003407425055853'));
    });

    it.skip('adding liquidity on 504 seconds spent after token adding', async () => {
      await time.increaseTo(fromTimestamp + 504);
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), ether('0.2889908266418344').toString());

      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('5899.768851799082289172').toString());
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('15675.3693888618190953').toString());

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('3.201405050545569136').toString());
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('1.006536370552462335').toString());
    });

    it.skip('adding liquidity on 1004 seconds spent after token adding', async () => {
      await time.increaseTo(fromTimestamp + 1004);
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), ether('0.5756880743023844').toString());

      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('11558.718885097058265985').toString());
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('30773.4872459462215729').toString());

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('5.932936219845902735').toString());
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('2.165818933934686168').toString());
    });

    it.skip('adding liquidity on 9004 seconds spent after token adding', async () => {
      await time.increaseTo(fromTimestamp + 9004);
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), ether('5.1628440368711844').toString());

      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('81529.79549770526208849').toString());
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('223344.9042523643384822').toString());

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('49.632038259679560435').toString());
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('97.581391795363609114').toString());
    });

    it('adding liquidity on 11000 seconds spent after token adding', async () => {
      await time.increase(11000);
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), targetWeight);

      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('93536.990954773869301382').toString());
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('258545.4312799397457545').toString());

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('59.539396924809173113').toString());
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('152.544804372061724031').toString());
    });

    it('set target dynamic weight to min and removing liquidity and then unbind', async () => {
      await time.increase(11000);
      assert.equal(await pool.getDenormalizedWeight(this.token3.address), targetWeight);

      const amountSwapOutBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutBeforeJoin, ether('93536.990954773869301382').toString());
      const poolAmountOutBeforeJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, initialBalance);
      assert.equal(poolAmountOutBeforeJoin, ether('258545.4312799397457545').toString());

      await this.joinswapTo1Ether();

      const amountSwapOutAfterJoin = await this.calcOutGivenIn(this.token3.address, tokens[0], initialBalance);
      assert.equal(amountSwapOutAfterJoin, ether('59.539396924809173113').toString());
      const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
      assert.equal(poolAmountOutAfterJoin, ether('152.544804372061724031').toString());

      const poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);
      await pool.setController(poolController.address);
      const fromTimestamp = await getTimestamp(100);
      await poolController.setDynamicWeightList([
        {
          token: this.token3.address,
          targetDenorm: await pool.MIN_WEIGHT(),
          fromTimestamp: fromTimestamp,
          targetTimestamp: await getTimestamp(11000),
        },
      ]);

      assert.equal(await pool.getDenormalizedWeight(this.token3.address), targetWeight);

      await expectRevert(poolController.unbindNotActualToken(this.token3.address, { from: alice }), 'DENORM_MIN');

      await time.increaseTo(fromTimestamp + 1004);

      await this.exitswapExternAmountOut(this.token3, ether('1'));
      await this.exitswapExternAmountOut(this.token3, ether('0.5'));
      await this.exitswapExternAmountOut(this.token3, ether('0.5'));
      await this.exitswapExternAmountOut(this.token3, ether('0.3'));
      await this.exitswapExternAmountOut(this.token3, ether('0.2'));
      await this.exitswapExternAmountOut(this.token3, ether('0.1'));
      await this.exitswapExternAmountOut(this.token3, ether('0.05'));
      await this.exitswapExternAmountOut(this.token3, ether('0.05'));

      await expectRevert(poolController.unbindNotActualToken(this.token3.address, { from: alice }), 'DENORM_MIN');

      await time.increaseTo(fromTimestamp + 11004);

      assert.equal(await pool.getDenormalizedWeight(this.token3.address), await pool.MIN_WEIGHT());
      assert.equal(await pool.isBound(this.token3.address), true);
      const tokenBalance = await pool.getBalance(this.token3.address);
      const communityWalletBalanceBeforeUnbind = await this.token3.balanceOf(communityWallet);

      // unbind by permissionless function
      await poolController.unbindNotActualToken(this.token3.address, { from: alice });
      assert.equal(await pool.isBound(this.token3.address), false);
      assert.equal(
        await this.token3.balanceOf(communityWallet),
        addBN(communityWalletBalanceBeforeUnbind, tokenBalance),
      );

      // bind again by controller
      const newFromTimestamp = await getTimestamp(100);
      const newTargetTimestamp = await getTimestamp(11000);

      await this.token3.approve(poolController.address, initialBalance);
      await poolController.bind(
        this.token3.address,
        initialBalance,
        targetWeight,
        newFromTimestamp,
        newTargetTimestamp,
      );
      assert.equal(await pool.isBound(this.token3.address), true);

      assert.deepEqual(
        _.pick(await pool.getDynamicWeightSettings(this.token3.address), [
          'fromTimestamp',
          'targetTimestamp',
          'fromDenorm',
          'targetDenorm',
        ]),
        {
          fromTimestamp: newFromTimestamp.toString(),
          targetTimestamp: newTargetTimestamp.toString(),
          fromDenorm: await pool.MIN_WEIGHT(),
          targetDenorm: targetWeight.toString(),
        },
      );
    });
  });

  describe('8 tokens', () => {
    const b = ether('0.001');
    const tw = ether('6.25');
    let fromTimestamp, targetTimestamp;

    beforeEach(async () => {
      const t2 = await MockERC20.new('My Token 2', 'MT2', '18', ether('1000000'));
      const t3 = await MockERC20.new('My Token 3', 'MT3', '18', ether('1000000'));
      const t4 = await MockERC20.new('My Token 4', 'MT4', '18', ether('1000000'));
      const t5 = await MockERC20.new('My Token 5', 'MT5', '18', ether('1000000'));
      const t6 = await MockERC20.new('My Token 6', 'MT6', '18', ether('1000000'));
      const t7 = await MockERC20.new('My Token 7', 'MT7', '18', ether('1000000'));
      const t8 = await MockERC20.new('My Token 8', 'MT8', '18', ether('1000000'));
      tokens = [this.token1.address, t2.address, t3.address, t4.address, t5.address, t6.address, t7.address, t8.address];

      let ft = await getTimestamp(100);
      let tt = await getTimestamp(11000);

      const newBalances = tokens.map((t, i) => mulBN(b, i + 1));
      const newTargetWeights = tokens.map(() => tw.toString());
      fromTimestamps = tokens.map(() => ft.toString());
      targetTimestamps = tokens.map(() => tt.toString());

      await pIteration.forEach(tokens, async (t, i) => {
        const token = await MockERC20.at(t);
        await token.approve(this.bActions.address, newBalances[i]);
      })

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
          balance: newBalances[i],
          targetDenorm: newTargetWeights[i],
          fromTimestamp: fromTimestamps[i],
          targetTimestamp: targetTimestamps[i],
        })),
      );

      const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(
        l => l.event === 'LOG_NEW_POOL',
      )[0];
      pool = await PowerIndexPool.at(logNewPool.args.pool);

      await time.increase(11000);
    });

    it('should correctly change 8-th token to new', async () => {
      const res = await this.joinPool(tokens, ether('18800'));
      const weiUsed = res.receipt.gasUsed * gasPrice;
      console.log('        joinPool gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));

      const oldTokenAddress = tokens[7];

      const poolAmountOutBeforeReplace = await this.calcPoolOutGivenSingleIn(oldTokenAddress, ether('0.0001'));
      assert.equal(poolAmountOutBeforeReplace, ether('0.154882811838447'));

      const minWeight = await pool.MIN_WEIGHT();
      const newToken = await MockERC20.new('New Token', 'NT', '18', ether('1000000'));

      assert.equal(await pool.isBound(newToken.address), false);
      assert.equal(await pool.getNumTokens(), '8');

      fromTimestamp = await getTimestamp(100);
      targetTimestamp = await getTimestamp(11000);

      const poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);
      await pool.setController(poolController.address);

      await newToken.approve(poolController.address, b);
      await expectRevert(
        poolController.bind(newToken.address, b, tw, fromTimestamp, targetTimestamp),
        'MAX_TARGET_TOTAL_WEIGHT'
      );

      await poolController.replaceTokenWithNew(oldTokenAddress, newToken.address, b, fromTimestamp, targetTimestamp);
      assert.equal(await pool.isBound(newToken.address), true);

      const oldTokenSettings = await pool.getDynamicWeightSettings(oldTokenAddress);
      assert.equal(oldTokenSettings.fromTimestamp, fromTimestamp);
      assert.equal(oldTokenSettings.targetTimestamp, targetTimestamp);
      assert.equal(oldTokenSettings.fromDenorm, tw);
      assert.equal(oldTokenSettings.targetDenorm, minWeight);

      const newTokenSettings = await pool.getDynamicWeightSettings(newToken.address);
      assert.equal(newTokenSettings.fromTimestamp, fromTimestamp);
      assert.equal(newTokenSettings.targetTimestamp, targetTimestamp);
      assert.equal(newTokenSettings.fromDenorm, minWeight);
      assert.equal(newTokenSettings.targetDenorm, subBN(tw, minWeight));

      assertEqualWithAccuracy(
        await this.calcPoolOutGivenSingleIn(newToken.address, ether('0.0001')),
        ether('0.003722400198'),
        ether('0.01')
      );
      assertEqualWithAccuracy(
        await this.calcPoolOutGivenSingleIn(oldTokenAddress, ether('0.0001')),
        ether('0.154882811838447'),
        ether('0.01')
      );

      assertEqualWithAccuracy(await pool.getBalance(newToken.address), ether('0.001'), ether('0.01'));
      assertEqualWithAccuracy(await pool.getBalance(oldTokenAddress), ether('150400.008'), ether('0.01'));

      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.0001'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.0001'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.0002'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.0003'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.0005'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.0008'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.001'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.0015'));

      assertEqualWithAccuracy(await pool.getBalance(newToken.address), ether('0.005275'), ether('0.05'));
      assertEqualWithAccuracy(await pool.getBalance(oldTokenAddress), ether('150400.007964752950931892'), ether('0.05'));

      await time.increase(11000 / 3);

      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.002'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.0025'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.003'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.005'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.007'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.01'));

      assertEqualWithAccuracy(await pool.getBalance(newToken.address), ether('0.0333'), ether('0.05'));
      assertEqualWithAccuracy(await pool.getBalance(oldTokenAddress), ether('60987.690675181463841264'), ether('0.05'));

      await time.increase(11000 / 3);

      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.015'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.02'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.03'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.04'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.07'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.1'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.15'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.2'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.3'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.4'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.6'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('0.8'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('1'));

      assertEqualWithAccuracy(await pool.getBalance(newToken.address), ether('3.57205'), ether('0.05'));
      assertEqualWithAccuracy(await pool.getBalance(oldTokenAddress), ether('5.06328129221017354'), ether('0.05'));

      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('1.2'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('1.5'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('2'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('2.5'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('5'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('7'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('10'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('15'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('20'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('30'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('45'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('60'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('90'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('100'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('150'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('200'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('300'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('500'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('750'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('1000'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('1500'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('2000'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('2500'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('3500'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('5000'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('7500'));
      await this.multihopBatchSwapExactIn(newToken.address, oldTokenAddress, ether('10000'));

      assertEqualWithAccuracy(await pool.getBalance(newToken.address), ether('33528.31205'), ether('0.05'));
      assertEqualWithAccuracy(await pool.getBalance(oldTokenAddress), ether('0.000000032762959096'), ether('0.05'));

      await time.increase(11000 / 3);

      assertEqualWithAccuracy(
        await this.calcPoolOutGivenSingleIn(oldTokenAddress, ether('0.00000001')),
        ether('0.011361611404341'),
        ether('0.05')
      );

      assertEqualWithAccuracy(
        await this.calcPoolOutGivenSingleIn(newToken.address, ether('0.0001')),
        ether('0.6947673398357076'),
        ether('0.05')
      );
    });

    it('should correctly change 8-th token by replaceTokenWithNewFromNow', async () => {
      await this.joinPool(tokens, ether('18800'));

      const oldTokenAddress = tokens[7];

      const minWeight = await pool.MIN_WEIGHT();
      const newToken = await MockERC20.new('New Token', 'NT', '18', ether('1000000'));

      assert.equal(await pool.isBound(newToken.address), false);
      assert.equal(await pool.getNumTokens(), '8');

      const poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);
      await pool.setController(poolController.address);

      const duration = '10000';
      await newToken.approve(poolController.address, b);
      const res = await poolController.replaceTokenWithNewFromNow(oldTokenAddress, newToken.address, b, duration);
      const txTimestamp = ((await web3.eth.getBlock(res.receipt.blockNumber)).timestamp + 1).toString();
      assert.equal(await pool.isBound(newToken.address), true);

      const oldTokenSettings = await pool.getDynamicWeightSettings(oldTokenAddress);
      assert.equal(oldTokenSettings.fromTimestamp, txTimestamp);
      assert.equal(oldTokenSettings.targetTimestamp, addBN(txTimestamp, duration));
      assert.equal(oldTokenSettings.fromDenorm, tw);
      assert.equal(oldTokenSettings.targetDenorm, minWeight);

      const newTokenSettings = await pool.getDynamicWeightSettings(newToken.address);
      assert.equal(newTokenSettings.fromTimestamp, txTimestamp);
      assert.equal(newTokenSettings.targetTimestamp, addBN(txTimestamp, duration));
      assert.equal(newTokenSettings.fromDenorm, minWeight);
      assert.equal(newTokenSettings.targetDenorm, subBN(tw, minWeight));
    });
  });

  async function getDenormWeight(token, timestamp) {
    if (!timestamp) {
      timestamp = await getTimestamp();
    }
    const dynamicWeight = await pool.getDynamicWeightSettings(token);
    if (
      dynamicWeight.fromTimestamp === '0' ||
      dynamicWeight.fromDenorm === dynamicWeight.targetDenorm ||
      isBNHigherOrEqual(dynamicWeight.fromTimestamp, timestamp)
    ) {
      return dynamicWeight.fromDenorm;
    }
    if (isBNHigherOrEqual(timestamp, dynamicWeight.targetTimestamp)) {
      return dynamicWeight.targetDenorm;
    }
    const deltaTargetTime = subBN(dynamicWeight.targetTimestamp, dynamicWeight.fromTimestamp);
    const deltaCurrentTime = subBN(timestamp, dynamicWeight.fromTimestamp);
    let deltaWeight;
    if (isBNHigher(dynamicWeight.targetDenorm, dynamicWeight.fromDenorm)) {
      deltaWeight = subBN(dynamicWeight.targetDenorm, dynamicWeight.fromDenorm);
      const weightPerSecond = divScalarBN(deltaWeight, deltaTargetTime);
      return addBN(dynamicWeight.fromDenorm, mulScalarBN(deltaCurrentTime, weightPerSecond));
    } else {
      deltaWeight = subBN(dynamicWeight.fromDenorm, dynamicWeight.targetDenorm);
      const weightPerSecond = divScalarBN(deltaWeight, deltaTargetTime);
      return subBN(dynamicWeight.fromDenorm, mulScalarBN(deltaCurrentTime, weightPerSecond));
    }
  }

  async function needTokensBalanceIn(pool, tokens) {
    let totalFromWeights = '0';
    let totalTargetWeights = '0';
    await pIteration.forEachSeries(tokens, async (t) => {
      const dw = await pool.getDynamicWeightSettings(t);
      totalFromWeights = addBN(totalFromWeights, dw.fromDenorm);
      totalTargetWeights = addBN(totalTargetWeights, dw.targetDenorm);
    });
    const tokenRatios = [];
    const tokenBalancesNeedIn = [];
    const tokenBalancesNeedInWithFee = [];
    await pIteration.forEachSeries(tokens, async (t, index) => {
      const dw = await pool.getDynamicWeightSettings(t);
      const balance = await pool.getBalance(t);
      tokenRatios[index] = divScalarBN(
        divScalarBN(dw.targetDenorm, totalTargetWeights),
        divScalarBN(dw.fromDenorm, totalFromWeights),
      );
      tokenBalancesNeedIn[index] = mulScalarBN(balance, subBN(tokenRatios[index], ether('1')));
      tokenBalancesNeedInWithFee[index] = divScalarBN(tokenBalancesNeedIn[index], subBN(ether('1'), communityJoinFee));
    });
    return tokenBalancesNeedInWithFee;
  }
});
