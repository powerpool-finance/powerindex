const { expectRevert, time, constants, expectEvent } = require('@openzeppelin/test-helpers');
const { buildBasicRouterConfig, buildBasicRouterArgs } = require('../helpers/builders');
const { ether } = require('../helpers');
const assert = require('chai').assert;
const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const MockERC20 = artifacts.require('MockERC20');
const MockCvp = artifacts.require('MockCvp');
const WETH = artifacts.require('MockWETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const PowerIndexWrapper = artifacts.require('PowerIndexWrapper');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const WrappedPiErc20Factory = artifacts.require('WrappedPiErc20Factory');
const BasicPowerIndexRouterFactory = artifacts.require('MockBasicPowerIndexRouterFactory');
const PowerIndexBasicRouter = artifacts.require('MockPowerIndexBasicRouter');

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
function greaterThenOrEqual(bn1, bn2) {
  return toBN(bn1.toString(10)).gte(toBN(bn2.toString(10)));
}

function assertEqualWithAccuracy(bn1, bn2, message, accuracyWei = '40') {
  bn1 = toBN(bn1.toString(10));
  bn2 = toBN(bn2.toString(10));
  const bn1GreaterThenBn2 = bn1.gt(bn2);
  let diff = bn1GreaterThenBn2 ? bn1.sub(bn2) : bn2.sub(bn1);
  assert.equal(diff.lte(toBN(accuracyWei)), true, message);
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

PowerIndexPool.numberFormat = 'String';
PowerIndexWrapper.numberFormat = 'String';
MockERC20.numberFormat = 'String';
MockCvp.numberFormat = 'String';
WETH.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

describe('PowerIndexWrapper', () => {
  const name = 'My Pool';
  const symbol = 'MP';
  const balances = [ether('10'), ether('20')];
  const weights = [ether('25'), ether('25')];
  const swapFee = ether('0.01').toString();
  const communitySwapFee = ether('0.05').toString();
  const communityJoinFee = ether('0.04').toString();
  const communityExitFee = ether('0.07').toString();
  const minWeightPerSecond = ether('0.00000001').toString();
  const maxWeightPerSecond = ether('0.1').toString();
  const piTokenEthFee = ether(0.0001).toString();

  let tokens, pool, poolWrapper, poolController, routerFactory, router;
  let defaultFactoryArguments;

  let minter, alice, communityWallet, poolRestrictions, stub;
  before(async function () {
    [minter, alice, communityWallet, poolRestrictions, stub] = await web3.eth.getAccounts();
    defaultFactoryArguments = buildBasicRouterArgs(web3, buildBasicRouterConfig(
      poolRestrictions,
      constants.ZERO_ADDRESS,
      constants.ZERO_ADDRESS,
      ether(0),
      '0',
      stub,
      ether(0),
      []
    ));
  });

  beforeEach(async () => {
    this.weth = await WETH.new();

    this.bFactory = await PowerIndexPoolFactory.new({ from: minter });
    this.bActions = await PowerIndexPoolActions.new({ from: minter });
    this.bExchange = await ExchangeProxy.new(this.weth.address, { from: minter });

    this.token1 = await MockCvp.new();
    this.token2 = await MockERC20.new('My Token 2', 'MT2', '18', ether('1000000'));
    tokens = [this.token1.address, this.token2.address];

    await this.token1.approve(this.bActions.address, balances[0]);
    await this.token2.approve(this.bActions.address, balances[1]);

    const fromTimestamps = [await getTimestamp(100), await getTimestamp(100)].map(w => w.toString());
    const targetTimestamps = [await getTimestamp(11000), await getTimestamp(11000)].map(w => w.toString());

    let res = await this.bActions.create(
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
        balance: balances[i].toString(),
        targetDenorm: weights[i].toString(),
        fromTimestamp: fromTimestamps[i].toString(),
        targetTimestamp: targetTimestamps[i].toString(),
      })),
    );

    const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
    pool = await PowerIndexPool.at(logNewPool.args.pool);

    poolWrapper = await PowerIndexWrapper.new(pool.address);

    const piTokenFactory = await WrappedPiErc20Factory.new();
    routerFactory = await BasicPowerIndexRouterFactory.new();
    poolController = await PowerIndexPoolController.new(pool.address, poolWrapper.address, piTokenFactory.address);

    await pool.setWrapper(poolWrapper.address, true);

    await poolWrapper.setController(poolController.address);
    await pool.setController(poolController.address);

    await time.increase(11000);

    res = await poolController.createPiToken(this.token2.address, routerFactory.address, defaultFactoryArguments, 'W T 2', 'WT2');
    this.piToken2 = await WrappedPiErc20.at(
      res.receipt.logs.filter(l => l.event === 'CreatePiToken')[0].args.piToken,
    );
    router = await PowerIndexBasicRouter.at(
      res.receipt.logs.filter(l => l.event === 'CreatePiToken')[0].args.router,
    );

    await router.setPiTokenEthFee(piTokenEthFee);

    await poolController.replacePoolTokenWithExistingPiToken(this.token2.address, this.piToken2.address, {
      value: piTokenEthFee
    });

    await time.increase(60);

    await poolController.finishReplace();

    this.getTokensToJoinPoolAndApprove = async amountToMint => {
      const poolTotalSupply = await pool.totalSupply();
      const ratio = divScalarBN(amountToMint, poolTotalSupply);
      const token1Amount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
      const token2Amount = mulScalarBN(ratio, await pool.getBalance(this.token2.address));
      await this.token1.approve(poolWrapper.address, token1Amount);
      await this.token2.approve(poolWrapper.address, token2Amount);
      return [token1Amount, token2Amount];
    };
  });

  it('ethFee should update correctly', async () => {
    assert.equal(await poolWrapper.ethFeeByPiToken(this.piToken2.address), ether(0.0001));

    let res = await poolWrapper.updatePiTokenEthFees([this.token2.address]);
    await expectEvent.notEmitted.inTransaction(res.tx, PowerIndexWrapper, 'UpdatePiTokenEthFee');

    await router.setPiTokenEthFee(ether(0.0001));
    res = await poolWrapper.updatePiTokenEthFees([this.token2.address]);
    await expectEvent.notEmitted.inTransaction(res.tx, PowerIndexWrapper, 'UpdatePiTokenEthFee');

    await router.setPiTokenEthFee(ether(0.0002));
    res = await poolWrapper.updatePiTokenEthFees([this.token2.address]);
    await expectEvent.inTransaction(res.tx, PowerIndexWrapper, 'UpdatePiTokenEthFee');

    assert.equal(await poolWrapper.ethFeeByPiToken(this.piToken2.address), ether(0.0002));
  });

  it('wrapper should be created successfully', async () => {
    assert.equal(await this.piToken2.name(), 'W T 2');
    assert.equal(await this.piToken2.symbol(), 'WT2');
    assert.equal(await this.piToken2.underlying(), this.token2.address);
    assert.equal(await this.piToken2.router(), router.address);
    assert.equal(await pool.isBound(this.piToken2.address), true);
    assert.equal(await pool.isBound(this.token2.address), false);
    assert.equal(await pool.getDenormalizedWeight(this.piToken2.address), weights[1]);
    assert.equal(await pool.getBalance(this.piToken2.address), balances[1]);
  });

  [0.5, 1, 1.5].forEach(piTokenRate => {
    describe(`join, exit and swap through with ${piTokenRate} rate`, () => {
      let amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut, ethFee;
      beforeEach(async () => {
        amountToSwap = ether('0.1').toString(10);

        await router.mockSetRate(ether(piTokenRate.toString()));

        await this.token1.transfer(alice, amountToSwap);
        await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
        await this.token1.approve(poolWrapper.address, amountToSwap, { from: alice });
        await this.token2.approve(poolWrapper.address, mulScalarBN(amountToSwap, ether('2')), { from: alice });
        await this.token1.approve(this.bExchange.address, amountToSwap, { from: alice });
        await this.token2.approve(this.bExchange.address, mulScalarBN(amountToSwap, ether('2')), { from: alice });

        ethFee = await poolWrapper.calcEthFeeForTokens([ this.token1.address, this.token2.address ]);
        assert.equal(ethFee, ether(0.0001));

        amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
        amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

        expectedSwapOut = await poolWrapper.calcOutGivenIn(
          await poolWrapper.getBalance(this.token1.address),
          weights[0],
          await poolWrapper.getBalance(this.token2.address),
          weights[1],
          amountAfterCommunitySwapFee,
          swapFee,
        );
      });

      it('swapExactAmountIn with regular token should works correctly', async () => {
        const price = await poolWrapper.calcSpotPrice(
          addBN(await poolWrapper.getBalance(this.token1.address), amountToSwap),
          weights[0],
          subBN(await poolWrapper.getBalance(this.token2.address), expectedSwapOut),
          weights[1],
          swapFee,
        );

        assert.equal(await this.token1.balanceOf(alice), amountToSwap);
        const token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);
        const token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        await expectRevert(
          pool.swapExactAmountIn(
            this.token1.address,
            amountToSwap,
            this.token2.address,
            expectedSwapOut,
            mulScalarBN(price, ether('1.05')),
            { from: alice },
          ),
          'ONLY_WRAPPER',
        );

        await expectRevert(
          poolWrapper.swapExactAmountIn(
            this.token1.address,
            amountToSwap,
            this.token2.address,
            expectedSwapOut,
            mulScalarBN(price, ether('1.05')),
            { from: alice },
          ),
          'function call failed to execute',
        );

        await poolWrapper.swapExactAmountIn(
          this.token1.address,
          amountToSwap,
          this.token2.address,
          expectedSwapOut,
          mulScalarBN(price, ether('1.05')),
          { from: alice, value: ethFee },
        );

        assert.equal(await this.token1.balanceOf(alice), '0');
        assert.equal(
          await this.token1.balanceOf(pool.address),
          addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee),
        );
        assertEqualWithAccuracy(
          await this.token2.balanceOf(alice),
          addBN(token2AliceBalanceBefore, expectedSwapOut),
        );
        assert.equal(
          greaterThenOrEqual(await this.token2.balanceOf(alice), addBN(token2AliceBalanceBefore, expectedSwapOut)),
          true
        );
      });

      it('swapExactAmountIn piToken should works correctly', async () => {
        const price = await poolWrapper.calcSpotPrice(
          addBN(await poolWrapper.getBalance(this.token2.address), amountToSwap),
          weights[1],
          subBN(await poolWrapper.getBalance(this.token1.address), expectedSwapOut),
          weights[0],
          swapFee,
        );

        const token2PoolBalanceBefore = await this.piToken2.balanceOf(pool.address);
        const token1AliceBalanceBefore = await this.token1.balanceOf(alice);
        const token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        expectedSwapOut = await poolWrapper.calcOutGivenIn(
          await poolWrapper.getBalance(this.token2.address),
          weights[1],
          await poolWrapper.getBalance(this.token1.address),
          weights[0],
          amountAfterCommunitySwapFee,
          swapFee,
        );

        await poolWrapper.swapExactAmountIn(
          this.token2.address,
          amountToSwap,
          this.token1.address,
          expectedSwapOut,
          mulScalarBN(price, ether('1.05')),
          { from: alice, value: ethFee },
        );

        assert.equal(await this.token2.balanceOf(alice), subBN(token2AliceBalanceBefore, amountToSwap));
        assert.equal(
          await this.piToken2.balanceOf(pool.address),
          addBN(token2PoolBalanceBefore, await this.piToken2.getPiEquivalentForUnderlying(amountAfterCommunitySwapFee)),
        );
        assertEqualWithAccuracy(
          await this.token1.balanceOf(alice),
          addBN(token1AliceBalanceBefore, expectedSwapOut),
        );
        assert.equal(
          greaterThenOrEqual(await this.token1.balanceOf(alice), addBN(token1AliceBalanceBefore, expectedSwapOut)),
          true
        );
      });

      it('swapExactAmountOut should works correctly', async () => {
        const expectedOutWithFee = await poolWrapper.calcOutGivenIn(
          await poolWrapper.getBalance(this.token1.address),
          weights[0],
          await poolWrapper.getBalance(this.token2.address),
          weights[1],
          amountToSwap,
          swapFee
        );
        const {tokenAmountInAfterFee: expectedOutWithoutFee} = await pool.calcAmountWithCommunityFee(expectedOutWithFee, communitySwapFee, poolWrapper.address);

        const price = await poolWrapper.calcSpotPrice(
          addBN(await poolWrapper.getBalance(this.token1.address), amountToSwap),
          weights[0],
          subBN(await poolWrapper.getBalance(this.token2.address), expectedOutWithFee),
          weights[1],
          swapFee,
        );

        assert.equal(await this.token1.balanceOf(alice), amountToSwap);
        const token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);
        const token2PoolBalanceBefore = await this.piToken2.balanceOf(pool.address);
        const token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        await expectRevert(
          pool.swapExactAmountOut(
            this.token1.address,
            amountToSwap,
            this.token2.address,
            expectedOutWithFee,
            mulScalarBN(price, ether('1.05')),
            { from: alice },
          ),
          'ONLY_WRAPPER',
        );

        await expectRevert(
          poolWrapper.swapExactAmountOut(
            this.token1.address,
            amountToSwap,
            this.token2.address,
            expectedOutWithFee,
            mulScalarBN(price, ether('1.05')),
            { from: alice },
          ),
          'function call failed to execute',
        );

        await poolWrapper.swapExactAmountOut(
          this.token1.address,
          amountToSwap,
          this.token2.address,
          expectedOutWithFee,
          mulScalarBN(price, ether('1.05')),
          { from: alice, value: ethFee },
        );

        assertEqualWithAccuracy(await this.token1.balanceOf(alice), '0');
        assertEqualWithAccuracy(
          await this.token1.balanceOf(pool.address),
          addBN(token1PoolBalanceBefore, amountToSwap),
        );
        assertEqualWithAccuracy(
          await this.piToken2.balanceOf(pool.address),
          subBN(token2PoolBalanceBefore, await this.piToken2.getPiEquivalentForUnderlying(expectedOutWithFee)),
        );
        assertEqualWithAccuracy(
          await this.token2.balanceOf(alice),
          addBN(token2AliceBalanceBefore, expectedOutWithoutFee),
        );
        //TODO: find the way to solve wei problem
        // assert.equal(greaterThenOrEqual(
        //   await this.token2.balanceOf(alice),
        //   addBN(token2AliceBalanceBefore, expectedOutWithoutFee),
        // ), true);
      });

      it('swapExactAmountOut piToken should works correctly', async () => {
        const expectedOutWithFee = await poolWrapper.calcOutGivenIn(
          await poolWrapper.getBalance(this.token2.address),
          weights[1],
          await poolWrapper.getBalance(this.token1.address),
          weights[0],
          amountToSwap,
          swapFee
        );
        const {tokenAmountInAfterFee: expectedOutWithoutFee} = await pool.calcAmountWithCommunityFee(expectedOutWithFee, communitySwapFee, poolWrapper.address);

        const price = await poolWrapper.calcSpotPrice(
          addBN(await poolWrapper.getBalance(this.token2.address), amountToSwap),
          weights[1],
          subBN(await poolWrapper.getBalance(this.token1.address), expectedOutWithFee),
          weights[0],
          swapFee,
        );

        const token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);
        const token2PoolBalanceBefore = await this.piToken2.balanceOf(pool.address);
        const token1AliceBalanceBefore = await this.token1.balanceOf(alice);
        const token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        await poolWrapper.swapExactAmountOut(
          this.token2.address,
          amountToSwap,
          this.token1.address,
          expectedOutWithFee,
          mulScalarBN(price, ether('1.05')),
          { from: alice, value: ethFee },
        );

        assertEqualWithAccuracy(await this.token2.balanceOf(alice), subBN(token2AliceBalanceBefore, amountToSwap));
        assertEqualWithAccuracy(
          await this.token1.balanceOf(pool.address),
          subBN(token1PoolBalanceBefore, expectedOutWithFee),
        );
        assertEqualWithAccuracy(
          await this.piToken2.balanceOf(pool.address),
          addBN(token2PoolBalanceBefore, await this.piToken2.getPiEquivalentForUnderlying(amountToSwap)),
        );
        assertEqualWithAccuracy(
          await this.token1.balanceOf(alice),
          addBN(token1AliceBalanceBefore, expectedOutWithoutFee),
        );
        assert.equal(greaterThenOrEqual(
          await this.token1.balanceOf(alice),
          addBN(token1AliceBalanceBefore, expectedOutWithoutFee)
        ), true)
      });

      it('joinswapExternAmountIn and exitswapPoolAmountIn should works correctly', async () => {
        const amountCommunityJoinFee = mulScalarBN(amountToSwap, communityJoinFee);
        const amountAfterCommunityJoinFee = subBN(amountToSwap, amountCommunityJoinFee);

        const minPoolAmountOut = await poolWrapper.calcPoolOutGivenSingleIn(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountAfterCommunityJoinFee,
          swapFee,
        );

        let token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);

        await expectRevert(
          pool.joinswapExternAmountIn(this.token1.address, amountToSwap, minPoolAmountOut, { from: alice }),
          'ONLY_WRAPPER',
        );

        await poolWrapper.joinswapExternAmountIn(
          this.token1.address,
          amountToSwap,
          minPoolAmountOut,
          { from: alice }
        );

        assert.equal(await this.token1.balanceOf(alice), '0');
        assert.equal(
          await this.token1.balanceOf(pool.address),
          addBN(token1PoolBalanceBefore, amountAfterCommunityJoinFee),
        );
        assert.equal(greaterThenOrEqual(await pool.balanceOf(alice), minPoolAmountOut), true);
        assertEqualWithAccuracy(await pool.balanceOf(alice), minPoolAmountOut);

        const minExitTokenAmountOut = await poolWrapper.calcSingleOutGivenPoolIn(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          minPoolAmountOut,
          swapFee,
        );

        token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);

        await pool.approve(poolWrapper.address, minPoolAmountOut, { from: alice });

        await expectRevert(
          pool.exitswapPoolAmountIn(this.token1.address, minPoolAmountOut, minExitTokenAmountOut, { from: alice }),
          'ONLY_WRAPPER',
        );

        await poolWrapper.exitswapPoolAmountIn(
          this.token1.address,
          minPoolAmountOut,
          minExitTokenAmountOut,
          { from: alice, value: ethFee }
        );

        const exitTokenAmountCommunityFee = mulScalarBN(minExitTokenAmountOut, communityExitFee);
        const exitTokenAmountAfterCommunityFee = subBN(minExitTokenAmountOut, exitTokenAmountCommunityFee);

        assert.equal(greaterThenOrEqual(await this.token1.balanceOf(alice), exitTokenAmountAfterCommunityFee), true);
        assertEqualWithAccuracy(await this.token1.balanceOf(alice), exitTokenAmountAfterCommunityFee);
        assertEqualWithAccuracy(
          await this.token1.balanceOf(pool.address),
          subBN(token1PoolBalanceBefore, minExitTokenAmountOut),
        );
        assertEqualWithAccuracy(await pool.balanceOf(alice), '0');
      });

      it('joinswapExternAmountIn and exitswapPoolAmountIn piToken should works correctly', async () => {
        const amountCommunityJoinFee = mulScalarBN(amountToSwap, communityJoinFee);
        const amountAfterCommunityJoinFee = subBN(amountToSwap, amountCommunityJoinFee);

        const minPoolAmountOut = await poolWrapper.calcPoolOutGivenSingleIn(
          await poolWrapper.getBalance(this.token2.address),
          await poolWrapper.getDenormalizedWeight(this.token2.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountAfterCommunityJoinFee,
          swapFee,
        );

        let token2PoolBalanceBefore = await this.piToken2.balanceOf(pool.address);
        let token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        await poolWrapper.joinswapExternAmountIn(
          this.token2.address,
          amountToSwap,
          minPoolAmountOut,
          { from: alice, value: ethFee }
        );

        assertEqualWithAccuracy(
          await this.piToken2.balanceOf(pool.address),
          addBN(token2PoolBalanceBefore, await this.piToken2.getPiEquivalentForUnderlying(amountAfterCommunityJoinFee)),
        );
        assert.equal(greaterThenOrEqual(await pool.balanceOf(alice), minPoolAmountOut), true);
        assertEqualWithAccuracy(await pool.balanceOf(alice), minPoolAmountOut);
        assert.equal(await this.token2.balanceOf(alice), subBN(token2AliceBalanceBefore, amountToSwap));

        const minExitTokenAmountOut = await poolWrapper.calcSingleOutGivenPoolIn(
          await poolWrapper.getBalance(this.token2.address),
          await poolWrapper.getDenormalizedWeight(this.token2.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          minPoolAmountOut,
          swapFee,
        );

        token2PoolBalanceBefore = await this.piToken2.balanceOf(pool.address);

        await pool.approve(poolWrapper.address, minPoolAmountOut, { from: alice });

        await poolWrapper.exitswapPoolAmountIn(
          this.token2.address,
          minPoolAmountOut,
          minExitTokenAmountOut,
          { from: alice, value: ethFee }
        );

        const exitTokenAmountCommunityFee = mulScalarBN(minExitTokenAmountOut, communityExitFee);
        const exitTokenAmountAfterCommunityFee = subBN(minExitTokenAmountOut, exitTokenAmountCommunityFee);

        assert.equal(greaterThenOrEqual(await this.token1.balanceOf(alice), exitTokenAmountAfterCommunityFee), true);
        assertEqualWithAccuracy(
          await this.token2.balanceOf(alice),
          addBN(subBN(token2AliceBalanceBefore, amountToSwap), exitTokenAmountAfterCommunityFee)
        );
        assertEqualWithAccuracy(
          await this.piToken2.balanceOf(pool.address),
          subBN(token2PoolBalanceBefore, await this.piToken2.getPiEquivalentForUnderlying(minExitTokenAmountOut)),
        );
        assertEqualWithAccuracy(await pool.balanceOf(alice), '0');
      });

      it('joinswapPoolAmountOut and exitswapExternAmountOut should works correctly', async () => {
        const poolAmountOutWithoutFee = await poolWrapper.calcPoolOutGivenSingleIn(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountToSwap,
          swapFee,
        );

        const amountIn = await poolWrapper.calcSingleInGivenPoolOut(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          poolAmountOutWithoutFee,
          swapFee,
        );

        let token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);

        await expectRevert(
          pool.joinswapPoolAmountOut(this.token1.address, poolAmountOutWithoutFee, amountIn, { from: alice }),
          'ONLY_WRAPPER',
        );

        await this.token1.transfer(alice, subBN(amountIn, amountToSwap));
        await this.token1.approve(poolWrapper.address, amountIn, {from: alice});

        await poolWrapper.joinswapPoolAmountOut(
          this.token1.address,
          poolAmountOutWithoutFee,
          amountIn,
          { from: alice, value: ethFee }
        );

        const {tokenAmountInAfterFee: poolAmountOutAfterFee} = await pool.calcAmountWithCommunityFee(poolAmountOutWithoutFee, communityJoinFee, poolWrapper.address);

        assert.equal(await this.token1.balanceOf(alice), '0');
        assertEqualWithAccuracy(
          await this.token1.balanceOf(pool.address),
          addBN(token1PoolBalanceBefore, amountIn),
        );
        assert.equal(greaterThenOrEqual(await pool.balanceOf(alice), poolAmountOutAfterFee), true);
        assertEqualWithAccuracy(await pool.balanceOf(alice), poolAmountOutAfterFee);

        const amountToExit = ether('0.05').toString(10);

        const poolAmountIn = await poolWrapper.calcPoolInGivenSingleOut(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountToExit,
          swapFee,
        );

        token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);
        const token1AliceBalanceBefore = await this.token1.balanceOf(alice);
        const poolAliceBalanceBefore = await pool.balanceOf(alice);

        await pool.approve(poolWrapper.address, poolAmountIn, { from: alice });

        await expectRevert(
          pool.exitswapExternAmountOut(this.token1.address, amountToExit, poolAmountIn, { from: alice }),
          'ONLY_WRAPPER',
        );

        await poolWrapper.exitswapExternAmountOut(
          this.token1.address,
          amountToExit,
          poolAmountIn,
          { from: alice }
        );

        const {tokenAmountInAfterFee: amountToExitAfterFee} = await pool.calcAmountWithCommunityFee(amountToExit, communityExitFee, poolWrapper.address);

        assertEqualWithAccuracy(
          await this.token1.balanceOf(alice),
          addBN(token1AliceBalanceBefore, amountToExitAfterFee)
        );
        assert.equal(
          await this.token1.balanceOf(pool.address),
          subBN(token1PoolBalanceBefore, amountToExit),
        );
        assertEqualWithAccuracy(
          await pool.balanceOf(alice),
          subBN(poolAliceBalanceBefore, poolAmountIn)
        );
      });

      it('joinswapPoolAmountOut and exitswapExternAmountOut piToken should works correctly', async () => {
        const poolAmountOutWithoutFee = await poolWrapper.calcPoolOutGivenSingleIn(
          await poolWrapper.getBalance(this.token2.address),
          await poolWrapper.getDenormalizedWeight(this.token2.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountToSwap,
          swapFee,
        );

        const amountIn = await poolWrapper.calcSingleInGivenPoolOut(
          await poolWrapper.getBalance(this.token2.address),
          await poolWrapper.getDenormalizedWeight(this.token2.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          poolAmountOutWithoutFee,
          swapFee,
        );

        let token2PoolBalanceBefore = await this.piToken2.balanceOf(pool.address);
        let token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        const res = await poolWrapper.joinswapPoolAmountOut(
          this.token2.address,
          poolAmountOutWithoutFee,
          amountIn,
          { from: alice, value: ethFee }
        );
        const logJoin = PowerIndexPool.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_JOIN')[0];

        const {tokenAmountInAfterFee: poolAmountOutAfterFee} = await pool.calcAmountWithCommunityFee(poolAmountOutWithoutFee, communityJoinFee, poolWrapper.address);

        assert.equal(await this.token2.balanceOf(alice), subBN(token2AliceBalanceBefore, amountIn));
        assert.equal(
          await this.piToken2.balanceOf(pool.address),
          addBN(token2PoolBalanceBefore, logJoin.args.tokenAmountIn),
        );
        assert.equal(greaterThenOrEqual(await pool.balanceOf(alice), poolAmountOutAfterFee), true);
        assertEqualWithAccuracy(await pool.balanceOf(alice), poolAmountOutAfterFee);

        const amountToExit = ether('0.05').toString(10);

        const poolAmountIn = await poolWrapper.calcPoolInGivenSingleOut(
          await poolWrapper.getBalance(this.token2.address),
          await poolWrapper.getDenormalizedWeight(this.token2.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountToExit,
          swapFee,
        );

        const poolAliceBalanceBefore = await pool.balanceOf(alice);

        await pool.approve(poolWrapper.address, poolAmountIn, { from: alice });

        token2PoolBalanceBefore = await this.piToken2.balanceOf(pool.address);
        token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        const {tokenAmountInAfterFee: amountToExitAfterFee} = await pool.calcAmountWithCommunityFee(amountToExit, communityExitFee, poolWrapper.address);

        await poolWrapper.exitswapExternAmountOut(
          this.token2.address,
          amountToExit,
          poolAmountIn,
          { from: alice, value: ethFee }
        );

        assertEqualWithAccuracy(await this.token2.balanceOf(alice), addBN(token2AliceBalanceBefore, amountToExitAfterFee));
        assert.equal(
          await this.piToken2.balanceOf(pool.address),
          subBN(token2PoolBalanceBefore, await this.piToken2.getPiEquivalentForUnderlying(amountToExit)),
        );
        assertEqualWithAccuracy(
          await pool.balanceOf(alice),
          subBN(poolAliceBalanceBefore, poolAmountIn)
        );
      });

      it('joinPool and exitPool should works correctly', async () => {
        const poolOutAmount = divScalarBN(
          mulScalarBN(amountToSwap, await pool.totalSupply()),
          await pool.getBalance(this.token1.address),
        );
        let ratio = divScalarBN(poolOutAmount, await pool.totalSupply());
        const token1InAmount = mulScalarBN(ratio, await poolWrapper.getBalance(this.token1.address));
        const token2InAmount = mulScalarBN(ratio, await poolWrapper.getBalance(this.token2.address));

        await this.token1.transfer(alice, token1InAmount);
        await this.token1.approve(poolWrapper.address, token1InAmount, {from: alice});
        await this.token2.transfer(alice, token2InAmount);
        await this.token2.approve(poolWrapper.address, token2InAmount, {from: alice});

        let token1AliceBalanceBefore = await this.token1.balanceOf(alice);
        let token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        const poolOutAmountFee = mulScalarBN(poolOutAmount, communityJoinFee);
        const poolOutAmountAfterFee = subBN(poolOutAmount, poolOutAmountFee);

        // await expectRevert(
        //   pool.joinPool(poolOutAmount, [token1InAmount, token2InAmount], { from: alice }),
        //   'ONLY_WRAPPER',
        // );
        //
        // await expectRevert(
        //   poolWrapper.joinPool(poolOutAmount, [token1InAmount, token2InAmount], { from: alice }),
        //   'function call failed to execute',
        // );

        await poolWrapper.joinPool(
          poolOutAmount,
          [token1InAmount, token2InAmount],
          { from: alice, value: ethFee }
        );

        assert.equal(await this.token1.balanceOf(alice), subBN(token1AliceBalanceBefore, token1InAmount));
        assert.equal(await this.token2.balanceOf(alice), subBN(token2AliceBalanceBefore, token2InAmount));
        assert.equal(await this.token1.balanceOf(pool.address), addBN(token1InAmount, balances[0]));
        assert.equal(
          await this.piToken2.balanceOf(pool.address),
          addBN(await this.piToken2.getPiEquivalentForUnderlying(token2InAmount), balances[1])
        );
        assert.equal(await pool.balanceOf(alice), poolOutAmountAfterFee);

        const poolInAmountFee = mulScalarBN(poolOutAmountAfterFee, communityExitFee);
        const poolInAmountAfterFee = subBN(poolOutAmountAfterFee, poolInAmountFee);

        ratio = divScalarBN(poolInAmountAfterFee, await pool.totalSupply());
        const token1OutAmount = mulScalarBN(ratio, await poolWrapper.getBalance(this.token1.address));
        const token2OutAmount = mulScalarBN(ratio, await poolWrapper.getBalance(this.token2.address));

        await pool.approve(poolWrapper.address, poolOutAmountAfterFee, { from: alice });

        await expectRevert(
          pool.exitPool(poolOutAmountAfterFee, [token1OutAmount, token2OutAmount], { from: alice }),
          'ONLY_WRAPPER',
        );
        await expectRevert(
          poolWrapper.exitPool(poolOutAmountAfterFee, [token1OutAmount, token2OutAmount], { from: alice }),
          'function call failed to execute',
        );

        token1AliceBalanceBefore = await this.token1.balanceOf(alice);
        token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        await poolWrapper.exitPool(
          poolOutAmountAfterFee,
          [token1OutAmount, token2OutAmount],
          { from: alice, value: ethFee }
        );

        assertEqualWithAccuracy(await pool.balanceOf(alice), '0');
        assertEqualWithAccuracy(await this.token1.balanceOf(alice), addBN(token1AliceBalanceBefore, token1OutAmount));
        assertEqualWithAccuracy(await this.token2.balanceOf(alice), addBN(token2AliceBalanceBefore, token2OutAmount));
        assertEqualWithAccuracy(
          await this.token1.balanceOf(pool.address),
          subBN(addBN(token1InAmount, balances[0]), token1OutAmount),
        );
        assertEqualWithAccuracy(
          await this.piToken2.balanceOf(pool.address),
          subBN(
            addBN(await this.piToken2.getPiEquivalentForUnderlying(token2InAmount), balances[1]),
            await this.piToken2.getPiEquivalentForUnderlying(token2OutAmount)
          ),
        );
      });

      it('swapExactAmountIn should works correctly', async () => {
        const price = await poolWrapper.calcSpotPrice(
          addBN(await poolWrapper.getBalance(this.token1.address), amountToSwap),
          weights[0],
          subBN(await poolWrapper.getBalance(this.token2.address), expectedSwapOut),
          weights[1],
          swapFee,
        );

        assert.equal(await this.token1.balanceOf(alice), amountToSwap);
        const token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);
        const token2AliceBalanceBefore = await this.token2.balanceOf(alice);

        await this.token1.approve(poolWrapper.address, amountToSwap, { from: alice });

        await expectRevert(
          pool.swapExactAmountIn(
            this.token1.address,
            amountToSwap,
            this.token2.address,
            expectedSwapOut,
            mulScalarBN(price, ether('1.05')),
            { from: alice },
          ),
          'ONLY_WRAPPER',
        );

        await expectRevert(
          poolWrapper.swapExactAmountIn(
            this.token1.address,
            amountToSwap,
            this.token2.address,
            expectedSwapOut,
            mulScalarBN(price, ether('1.05')),
            { from: alice },
          ),
          'function call failed to execute',
        );

        await poolWrapper.swapExactAmountIn(
          this.token1.address,
          amountToSwap,
          this.token2.address,
          expectedSwapOut,
          mulScalarBN(price, ether('1.05')),
          { from: alice, value: ethFee },
        );

        assert.equal(await this.token1.balanceOf(alice), '0');
        assert.equal(
          await this.token1.balanceOf(pool.address),
          addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee),
        );

        assertEqualWithAccuracy(
          await this.token2.balanceOf(alice),
          addBN(token2AliceBalanceBefore, expectedSwapOut),
        );
      });

      it('withdrawOddEthFee should works correctly', async () => {
        const poolAmountOutWithoutFee = await poolWrapper.calcPoolOutGivenSingleIn(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountToSwap,
          swapFee,
        );

        const amountIn = await poolWrapper.calcSingleInGivenPoolOut(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          poolAmountOutWithoutFee,
          swapFee,
        );

        await this.token1.transfer(alice, subBN(amountIn, amountToSwap));
        await this.token1.approve(poolWrapper.address, amountIn, {from: alice});

        await poolWrapper.joinswapPoolAmountOut(
          this.token1.address,
          poolAmountOutWithoutFee,
          amountIn,
          {from: alice, value: ethFee}
        );

        assert.equal(await web3.eth.getBalance(poolWrapper.address), ethFee);
        await expectRevert(
          poolWrapper.withdrawOddEthFee(communityWallet, {from: minter}),
          'NOT_CONTROLLER',
        );

        const communityWalletEthBalanceBefore = await web3.eth.getBalance(communityWallet);
        await poolController.migrateController(minter, [poolWrapper.address], {from: minter});
        await poolWrapper.withdrawOddEthFee(communityWallet, {from: minter});
        assert.equal(addBN(communityWalletEthBalanceBefore, ethFee), await web3.eth.getBalance(communityWallet));
        assert.equal(await web3.eth.getBalance(poolWrapper.address), ether(0));
      });
    });
  });
});
