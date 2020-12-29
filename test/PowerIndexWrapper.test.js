const { expectRevert, ether } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const MockCvp = artifacts.require('MockCvp');
const WETH = artifacts.require('MockWETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const PowerIndexWrapper = artifacts.require('PowerIndexWrapper');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const PowerIndexSimpleRouter = artifacts.require('PowerIndexSimpleRouter');
const WrappedPiErc20Factory = artifacts.require('WrappedPiErc20Factory');

const { web3 } = BFactory;
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

function assertEqualWithAccuracy(bn1, bn2, message, accuracyWei = '30') {
  bn1 = toBN(bn1.toString(10));
  bn2 = toBN(bn2.toString(10));
  const bn1GreaterThenBn2 = bn1.gt(bn2);
  let diff = bn1GreaterThenBn2 ? bn1.sub(bn2) : bn2.sub(bn1);
  assert.equal(diff.lte(toBN(accuracyWei)), true, message);
}

describe('PowerIndexWrapper', () => {
  const name = 'My Pool';
  const symbol = 'MP';
  const balances = [ether('10'), ether('20')];
  const weights = [ether('25'), ether('25')];
  const swapFee = ether('0.01');
  const communitySwapFee = ether('0.05');
  const communityJoinFee = ether('0.04');
  const communityExitFee = ether('0.07');

  let tokens, pool, poolWrapper, poolController, poolRouter, poolRestrictions;

  let minter, alice, communityWallet;
  before(async function () {
    [minter, alice, communityWallet, poolRestrictions] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();

    this.bFactory = await BFactory.new({ from: minter });
    this.bActions = await BActions.new({ from: minter });
    this.bExchange = await ExchangeProxy.new(this.weth.address, { from: minter });

    this.token1 = await MockCvp.new();
    this.token2 = await MockERC20.new('My Token 2', 'MT2', '18', ether('1000000'));
    tokens = [this.token1.address, this.token2.address];

    await this.token1.approve(this.bActions.address, balances[0]);
    await this.token2.approve(this.bActions.address, balances[1]);

    let res = await this.bActions.create(
      this.bFactory.address,
      name,
      symbol,
      tokens,
      balances,
      weights,
      [swapFee, communitySwapFee, communityJoinFee, communityExitFee],
      communityWallet,
      true,
    );

    const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
    pool = await BPool.at(logNewPool.args.pool);

    poolWrapper = await PowerIndexWrapper.new(pool.address);
    const wrapperFactory = await WrappedPiErc20Factory.new();
    poolController = await PowerIndexPoolController.new(pool.address, poolWrapper.address, wrapperFactory.address);
    poolRouter = await PowerIndexSimpleRouter.new(poolRestrictions);

    await pool.setWrapper(poolWrapper.address, true);

    await poolWrapper.setController(poolController.address);
    await pool.setController(poolController.address);

    res = await poolController.replacePoolTokenWithNewWrapped(this.token2.address, poolRouter.address, 'W T 2', 'WT2');
    this.token2Wrapper = await WrappedPiErc20.at(
      res.receipt.logs.filter(l => l.event === 'ReplacePoolTokenWithWrapped')[0].args.wrappedToken,
    );

    this.getTokensToJoinPoolAndApprove = async amountToMint => {
      const poolTotalSupply = (await pool.totalSupply()).toString(10);
      const ratio = divScalarBN(amountToMint, poolTotalSupply);
      const token1Amount = mulScalarBN(ratio, (await pool.getBalance(this.token1.address)).toString(10));
      const token2Amount = mulScalarBN(ratio, (await pool.getBalance(this.token2.address)).toString(10));
      await this.token1.approve(poolWrapper.address, token1Amount);
      await this.token2.approve(poolWrapper.address, token2Amount);
      return [token1Amount, token2Amount];
    };
  });

  it('wrapper should be created successfully', async () => {
    assert.equal(await this.token2Wrapper.name(), 'W T 2');
    assert.equal(await this.token2Wrapper.symbol(), 'WT2');
    assert.equal(await this.token2Wrapper.token(), this.token2.address);
    assert.equal(await this.token2Wrapper.router(), poolRouter.address);
    assert.equal(await pool.isBound(this.token2Wrapper.address), true);
    assert.equal(await pool.isBound(this.token2.address), false);
  });

  describe('join, exit and swap through', () => {
    let amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut;
    beforeEach(async () => {
      amountToSwap = ether('0.1').toString(10);
      await this.token1.transfer(alice, amountToSwap);
      await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
      await this.token1.approve(poolWrapper.address, amountToSwap, { from: alice });
      await this.token2.approve(poolWrapper.address, mulScalarBN(amountToSwap, ether('2')), { from: alice });
      await this.token1.approve(this.bExchange.address, amountToSwap, { from: alice });
      await this.token2.approve(this.bExchange.address, mulScalarBN(amountToSwap, ether('2')), { from: alice });

      amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
      amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

      expectedSwapOut = (
        await pool.calcOutGivenIn(
          balances[0],
          weights[0],
          balances[1],
          weights[1],
          amountAfterCommunitySwapFee,
          swapFee,
        )
      ).toString(10);
    });

    it('swapExactAmountIn should works correctly', async () => {
      const price = (
        await pool.calcSpotPrice(
          addBN(balances[0], amountToSwap),
          weights[0],
          subBN(balances[1], expectedSwapOut),
          weights[1],
          swapFee,
        )
      ).toString(10);

      assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
      const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
      const token2AliceBalanceBefore = (await this.token2.balanceOf(alice)).toString();

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

      await poolWrapper.swapExactAmountIn(
        this.token1.address,
        amountToSwap,
        this.token2.address,
        expectedSwapOut,
        mulScalarBN(price, ether('1.05')),
        { from: alice },
      );

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee),
      );
      assert.equal(
        (await this.token2.balanceOf(alice)).toString(),
        addBN(token2AliceBalanceBefore, expectedSwapOut).toString(),
      );
    });

    it('swapExactAmountOut should works correctly', async () => {
      const expectedOutWithFee = (
        await pool.calcOutGivenIn(balances[0], weights[0], balances[1], weights[1], amountToSwap, swapFee)
      ).toString(10);
      const expectedOutFee = mulScalarBN(expectedOutWithFee, communitySwapFee);

      const price = (
        await pool.calcSpotPrice(
          addBN(balances[0], amountToSwap),
          weights[0],
          subBN(balances[1], expectedOutWithFee),
          weights[1],
          swapFee,
        )
      ).toString(10);

      assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
      const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
      const token2PoolBalanceBefore = (await this.token2Wrapper.balanceOf(pool.address)).toString();
      const token2AliceBalanceBefore = (await this.token2.balanceOf(alice)).toString();

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

      await poolWrapper.swapExactAmountOut(
        this.token1.address,
        amountToSwap,
        this.token2.address,
        expectedOutWithFee,
        mulScalarBN(price, ether('1.05')),
        { from: alice },
      );

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        addBN(token1PoolBalanceBefore, amountToSwap),
      );
      assert.equal(
        (await this.token2Wrapper.balanceOf(pool.address)).toString(),
        subBN(token2PoolBalanceBefore, expectedOutWithFee),
      );
      assert.equal(
        (await this.token2.balanceOf(alice)).toString(),
        addBN(token2AliceBalanceBefore, subBN(expectedOutWithFee, expectedOutFee)).toString(),
      );
    });

    it('joinswapExternAmountIn and exitswapPoolAmountIn should works correctly', async () => {
      const amountCommunityJoinFee = mulScalarBN(amountToSwap, communityJoinFee);
      const amountAfterCommunityJoinFee = subBN(amountToSwap, amountCommunityJoinFee);

      expectedSwapOut = (
        await pool.calcOutGivenIn(
          balances[0],
          weights[0],
          balances[1],
          weights[1],
          amountAfterCommunityJoinFee,
          swapFee,
        )
      ).toString(10);

      const poolAmountOut = (
        await pool.calcPoolOutGivenSingleIn(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountAfterCommunityJoinFee,
          swapFee,
        )
      ).toString(10);

      let token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();

      await expectRevert(
        pool.joinswapExternAmountIn(this.token1.address, amountToSwap, poolAmountOut, { from: alice }),
        'ONLY_WRAPPER',
      );

      await poolWrapper.joinswapExternAmountIn(this.token1.address, amountToSwap, poolAmountOut, { from: alice });

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        addBN(token1PoolBalanceBefore, amountAfterCommunityJoinFee),
      );
      assert.equal((await pool.balanceOf(alice)).toString(), poolAmountOut.toString());

      const exitTokenAmountOut = (
        await pool.calcSingleOutGivenPoolIn(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          poolAmountOut,
          swapFee,
        )
      ).toString(10);

      token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();

      await pool.approve(poolWrapper.address, poolAmountOut, { from: alice });

      await expectRevert(
        pool.exitswapPoolAmountIn(this.token1.address, poolAmountOut, exitTokenAmountOut, { from: alice }),
        'ONLY_WRAPPER',
      );

      await poolWrapper.exitswapPoolAmountIn(this.token1.address, poolAmountOut, exitTokenAmountOut, { from: alice });

      const exitTokenAmountCommunityFee = mulScalarBN(exitTokenAmountOut, communityExitFee);
      const exitTokenAmountAfterCommunityFee = subBN(exitTokenAmountOut, exitTokenAmountCommunityFee);

      assert.equal((await this.token1.balanceOf(alice)).toString(), exitTokenAmountAfterCommunityFee);
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        subBN(token1PoolBalanceBefore, exitTokenAmountOut),
      );
      assert.equal((await pool.balanceOf(alice)).toString(), '0');
    });

    it('joinswapPoolAmountOut and exitswapExternAmountOut should works correctly', async () => {
      const poolAmountOutWithoutFee = (
        await pool.calcPoolOutGivenSingleIn(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountToSwap,
          swapFee,
        )
      ).toString(10);

      const amountIn = (
        await pool.calcSingleInGivenPoolOut(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          poolAmountOutWithoutFee,
          swapFee,
        )
      ).toString(10);

      let token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();

      await expectRevert(
        pool.joinswapPoolAmountOut(this.token1.address, poolAmountOutWithoutFee, amountIn, { from: alice }),
        'ONLY_WRAPPER',
      );

      await this.token1.transfer(alice, subBN(amountIn, amountToSwap));
      await this.token1.approve(poolWrapper.address, amountIn, {from: alice});

      await poolWrapper.joinswapPoolAmountOut(this.token1.address, poolAmountOutWithoutFee, amountIn, { from: alice });

      const poolAmountOutAfterFee = subBN(poolAmountOutWithoutFee, mulScalarBN(poolAmountOutWithoutFee, communityJoinFee));

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        addBN(token1PoolBalanceBefore, amountIn),
      );
      assert.equal((await pool.balanceOf(alice)).toString(), poolAmountOutAfterFee.toString());

      const amountToExit = ether('0.05').toString(10);

      const poolAmountIn = (
        await pool.calcPoolInGivenSingleOut(
          await pool.getBalance(this.token1.address),
          await pool.getDenormalizedWeight(this.token1.address),
          await pool.totalSupply(),
          await pool.getTotalDenormalizedWeight(),
          amountToExit,
          swapFee,
        )
      ).toString(10);

      token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
      const token1AliceBalanceBefore = (await this.token1.balanceOf(alice)).toString();
      const poolAliceBalanceBefore = (await pool.balanceOf(alice)).toString();

      await pool.approve(poolWrapper.address, poolAmountIn, { from: alice });

      await expectRevert(
        pool.exitswapExternAmountOut(this.token1.address, amountToExit, poolAmountIn, { from: alice }),
        'ONLY_WRAPPER',
      );

      await poolWrapper.exitswapExternAmountOut(this.token1.address, amountToExit, poolAmountIn, { from: alice });

      assert.equal(
        (await this.token1.balanceOf(alice)).toString(),
        addBN(token1AliceBalanceBefore, subBN(amountToExit, mulScalarBN(amountToExit, communityExitFee)))
      );
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        subBN(token1PoolBalanceBefore, amountToExit),
      );
      assert.equal(
        (await pool.balanceOf(alice)).toString(),
        subBN(poolAliceBalanceBefore, poolAmountIn)
      );
    });

    it('joinPool and exitPool should works correctly', async () => {
      const poolOutAmount = divScalarBN(
        mulScalarBN(amountToSwap, await pool.totalSupply()),
        await pool.getBalance(this.token1.address),
      );
      let ratio = divScalarBN(poolOutAmount, await pool.totalSupply());
      const token1InAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
      const token2InAmount = mulScalarBN(ratio, await pool.getBalance(this.token2Wrapper.address));

      const poolOutAmountFee = mulScalarBN(poolOutAmount, communityJoinFee);
      const poolOutAmountAfterFee = subBN(poolOutAmount, poolOutAmountFee);

      await expectRevert(
        pool.joinPool(poolOutAmount, [token1InAmount, token2InAmount], { from: alice }),
        'ONLY_WRAPPER',
      );

      await poolWrapper.joinPool(poolOutAmount, [token1InAmount, token2InAmount], { from: alice });

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal((await this.token2.balanceOf(alice)).toString(), '0');
      assert.equal(await this.token1.balanceOf(pool.address), addBN(token1InAmount, balances[0]));
      assert.equal(await this.token2Wrapper.balanceOf(pool.address), addBN(token2InAmount, balances[1]));
      assert.equal((await pool.balanceOf(alice)).toString(), poolOutAmountAfterFee.toString());

      const poolInAmountFee = mulScalarBN(poolOutAmountAfterFee, communityExitFee);
      const poolInAmountAfterFee = subBN(poolOutAmountAfterFee, poolInAmountFee);

      ratio = divScalarBN(poolInAmountAfterFee, await pool.totalSupply());
      const token1OutAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
      const token2OutAmount = mulScalarBN(ratio, await pool.getBalance(this.token2Wrapper.address));

      await pool.approve(poolWrapper.address, poolOutAmountAfterFee, { from: alice });

      await expectRevert(
        pool.exitPool(poolOutAmountAfterFee, [token1OutAmount, token2OutAmount], { from: alice }),
        'ONLY_WRAPPER',
      );

      await poolWrapper.exitPool(poolOutAmountAfterFee, [token1OutAmount, token2OutAmount], { from: alice });

      assertEqualWithAccuracy((await pool.balanceOf(alice)).toString(), '0');
      assertEqualWithAccuracy((await this.token1.balanceOf(alice)).toString(), token1OutAmount);
      assertEqualWithAccuracy((await this.token2.balanceOf(alice)).toString(), token2OutAmount);
      assertEqualWithAccuracy(
        await this.token1.balanceOf(pool.address),
        subBN(addBN(token1InAmount, balances[0]), token1OutAmount),
      );
      assertEqualWithAccuracy(
        await this.token2Wrapper.balanceOf(pool.address),
        subBN(addBN(token2InAmount, balances[1]), token2OutAmount),
      );
    });

    it('swapExactAmountIn should works correctly', async () => {
      const price = (
        await pool.calcSpotPrice(
          addBN(balances[0], amountToSwap),
          weights[0],
          subBN(balances[1], expectedSwapOut),
          weights[1],
          swapFee,
        )
      ).toString(10);

      assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
      const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
      const token2AliceBalanceBefore = (await this.token2.balanceOf(alice)).toString();

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

      await poolWrapper.swapExactAmountIn(
        this.token1.address,
        amountToSwap,
        this.token2.address,
        expectedSwapOut,
        mulScalarBN(price, ether('1.05')),
        { from: alice },
      );

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee),
      );

      assert.equal(
        (await this.token2.balanceOf(alice)).toString(),
        addBN(token2AliceBalanceBefore, expectedSwapOut).toString(),
      );
    });
  });
});