const { expectRevert, ether } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const MockVoting = artifacts.require('MockVoting');
const MockCvp = artifacts.require('MockCvp');
const WETH = artifacts.require('MockWETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const PermanentVotingPowerV1 = artifacts.require('PermanentVotingPowerV1');
const PowerIndexWrapper = artifacts.require('PowerIndexWrapper');

BPool.numberFormat = 'String';

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

describe('Balancer', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const name = 'My Pool';
  const symbol = 'MP';
  const balances = [ether('10'), ether('20')];
  const weights = [ether('25'), ether('25')];
  const swapFee = ether('0.01');
  const communitySwapFee = ether('0.05');
  const communityJoinFee = ether('0.04');
  const communityExitFee = ether('0.07');

  let tokens;
  let pool;
  let permanentVotingPower;

  let minter, alice, feeManager, feeReceiver, newCommunityWallet;
  before(async function () {
    [minter, alice, feeManager, feeReceiver, newCommunityWallet] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();

    this.bFactory = await BFactory.new({ from: minter });
    this.bActions = await BActions.new({ from: minter });
    this.bExchange = await ExchangeProxy.new(this.weth.address, { from: minter });

    this.token1 = await MockCvp.new();
    this.token2 = await MockERC20.new('My Token 2', 'MT2', ether('1000000'));
    tokens = [this.token1.address, this.token2.address];

    permanentVotingPower = await PermanentVotingPowerV1.new();
    await permanentVotingPower.setFeeManager(feeManager, { from: minter });

    await this.token1.approve(this.bActions.address, balances[0]);
    await this.token2.approve(this.bActions.address, balances[1]);

    const res = await this.bActions.create(
      this.bFactory.address,
      name,
      symbol,
      tokens,
      balances,
      weights,
      [swapFee, communitySwapFee, communityJoinFee, communityExitFee],
      permanentVotingPower.address,
      true,
    );

    const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
    pool = await BPool.at(logNewPool.args.pool);

    this.getTokensToJoinPoolAndApprove = async (_pool, amountToMint) => {
      const poolTotalSupply = (await _pool.totalSupply()).toString(10);
      const ratio = divScalarBN(amountToMint, poolTotalSupply);
      const token1Amount = mulScalarBN(ratio, (await _pool.getBalance(this.token1.address)).toString(10));
      const token2Amount = mulScalarBN(ratio, (await _pool.getBalance(this.token2.address)).toString(10));
      await this.token1.approve(this.bActions.address, token1Amount);
      await this.token2.approve(this.bActions.address, token2Amount);
      return [token1Amount, token2Amount];
    };
  });

  it('should set name and symbol for new pool', async () => {
    assert.equal(await pool.name(), name);
    assert.equal(await pool.symbol(), symbol);
    assert.sameMembers(await pool.getCurrentTokens(), tokens);
    assert.equal((await pool.getDenormalizedWeight(tokens[0])).toString(), weights[0].toString());
    assert.equal((await pool.getDenormalizedWeight(tokens[1])).toString(), weights[1].toString());
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
    assert.equal(_communityFeeReceiver, permanentVotingPower.address);
  });

  it('bound check should work properly', async () => {
    //TODO: figure out - why NOT_BOUND revert message don't work in buidler environment
    await expectRevert.unspecified(pool.getDenormalizedWeight(alice), 'NOT_BOUND');
    await expectRevert.unspecified(pool.getNormalizedWeight(alice), 'NOT_BOUND');
    await expectRevert.unspecified(pool.getBalance(alice), 'NOT_BOUND');
    await expectRevert.unspecified(pool.rebind(alice, '0', '0', { from: minter }), 'NOT_BOUND');
    await expectRevert.unspecified(pool.unbind(alice, { from: minter }), 'NOT_BOUND');
    await expectRevert.unspecified(pool.gulp(alice, { from: minter }), 'NOT_BOUND');
    await expectRevert.unspecified(pool.getSpotPriceSansFee(this.token1.address, alice), 'NOT_BOUND');
    await expectRevert.unspecified(pool.getSpotPriceSansFee(alice, this.token1.address), 'NOT_BOUND');
    await expectRevert.unspecified(pool.swapExactAmountIn(alice, '0', this.token1.address, '0', '0'), 'NOT_BOUND');
    await expectRevert.unspecified(pool.swapExactAmountIn(this.token1.address, '0', alice, '0', '0'), 'NOT_BOUND');
    await expectRevert.unspecified(pool.swapExactAmountOut(alice, '0', this.token1.address, '0', '0'), 'NOT_BOUND');
    await expectRevert.unspecified(pool.swapExactAmountOut(this.token1.address, '0', alice, '0', '0'), 'NOT_BOUND');
    await expectRevert.unspecified(pool.joinswapExternAmountIn(alice, '0', '0'), 'NOT_BOUND');
    await expectRevert.unspecified(pool.joinswapPoolAmountOut(alice, '0', '0'), 'NOT_BOUND');
    await expectRevert.unspecified(pool.exitswapPoolAmountIn(alice, '0', '0'), 'NOT_BOUND');
    await expectRevert.unspecified(pool.exitswapExternAmountOut(alice, '0', '0'), 'NOT_BOUND');
  });

  it('controller check should work properly', async () => {
    await expectRevert(pool.setSwapFee('0', { from: alice }), 'NOT_CONTROLLER');
    await expectRevert(pool.setCommunityFeeAndReceiver('0', '0', '0', alice, { from: alice }), 'NOT_CONTROLLER');
    await expectRevert(pool.setRestrictions(alice, { from: alice }), 'NOT_CONTROLLER');
    await expectRevert(pool.setController(alice, { from: alice }), 'NOT_CONTROLLER');
    await expectRevert(pool.finalize({ from: alice }), 'NOT_CONTROLLER');
    await expectRevert(pool.bind(alice, '0', '0', { from: alice }), 'NOT_CONTROLLER');
    await expectRevert(pool.rebind(this.token1.address, '0', '0', { from: alice }), 'NOT_CONTROLLER');
    await expectRevert(pool.unbind(this.token1.address, { from: alice }), 'NOT_CONTROLLER');
  });

  it('finalized check should work properly', async () => {
    //TODO: figure out - why IS_FINALIZED revert message don't work in buidler environment
    await expectRevert.unspecified(pool.setPublicSwap(true, { from: minter }));
  });

  describe('community fee', () => {
    let pool, amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut;
    beforeEach(async () => {
      await this.token1.approve(this.bActions.address, balances[0]);
      await this.token2.approve(this.bActions.address, balances[1]);

      const res = await this.bActions.create(
        this.bFactory.address,
        name,
        symbol,
        tokens,
        balances,
        weights,
        [swapFee, communitySwapFee, communityJoinFee, communityExitFee],
        permanentVotingPower.address,
        true,
      );

      const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
      pool = await BPool.at(logNewPool.args.pool);

      amountToSwap = ether('0.1').toString(10);
      await this.token1.transfer(alice, amountToSwap);
      await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
      await this.token1.approve(this.bExchange.address, amountToSwap, { from: alice });
      await this.token1.approve(this.bActions.address, amountToSwap, { from: alice });
      await this.token2.approve(this.bActions.address, mulScalarBN(amountToSwap, ether('2')), { from: alice });

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

    it('should be able to set community fee and swap fee after finalized', async () => {
      assert.equal(await pool.isFinalized(), true);

      const newSwapFee = ether('0.02');
      await expectRevert(pool.setSwapFee(newSwapFee, { from: alice }), 'NOT_CONTROLLER');
      await pool.setSwapFee(newSwapFee, { from: minter });
      assert.equal((await pool.getSwapFee()).toString(), newSwapFee.toString());

      const newCommunitySwapFee = ether('0.01');
      const newCommunityJoinFee = ether('0.02');
      const newCommunityExitFee = ether('0.03');
      await expectRevert(
        pool.setCommunityFeeAndReceiver(
          newCommunitySwapFee,
          newCommunityJoinFee,
          newCommunityExitFee,
          newCommunityWallet,
          { from: alice },
        ),
        'NOT_CONTROLLER',
      );

      await pool.setCommunityFeeAndReceiver(
        newCommunitySwapFee,
        newCommunityJoinFee,
        newCommunityExitFee,
        newCommunityWallet,
        { from: minter },
      );

      const communityFee = await pool.getCommunityFee();
      assert.equal(communityFee.communitySwapFee.toString(10), newCommunitySwapFee);
      assert.equal(communityFee.communityJoinFee.toString(10), newCommunityJoinFee);
      assert.equal(communityFee.communityExitFee.toString(10), newCommunityExitFee);
      assert.equal(communityFee.communityFeeReceiver.toString(10), newCommunityWallet);
    });

    it('community fee should work properly for multihopBatchSwapExactIn', async () => {
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

      await this.bExchange.multihopBatchSwapExactIn(
        [
          [
            {
              pool: pool.address,
              tokenIn: this.token1.address,
              tokenOut: this.token2.address,
              swapAmount: amountToSwap,
              limitReturnAmount: expectedSwapOut,
              maxPrice: mulScalarBN(price, ether('1.05')),
            },
          ],
        ],
        this.token1.address,
        this.token2.address,
        amountToSwap,
        expectedSwapOut,
        { from: alice },
      );

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal(
        (await this.token1.balanceOf(permanentVotingPower.address)).toString(),
        amountCommunitySwapFee.toString(),
      );
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee),
      );
      assert.equal(
        (await this.token2.balanceOf(alice)).toString(),
        addBN(token2AliceBalanceBefore, expectedSwapOut).toString(),
      );

      await expectRevert(
        permanentVotingPower.setFeeManager(feeManager, { from: alice }),
        'Ownable: caller is not the owner',
      );

      await expectRevert(
        permanentVotingPower.withdraw([this.token1.address], [amountCommunitySwapFee], feeReceiver, { from: alice }),
        'NOT_FEE_MANAGER',
      );
      await permanentVotingPower.withdraw([this.token1.address], [amountCommunitySwapFee], feeReceiver, {
        from: feeManager,
      });

      assert.equal((await this.token1.balanceOf(feeReceiver)).toString(), amountCommunitySwapFee.toString());
      assert.equal((await this.token1.balanceOf(feeManager)).toString(), '0');
      assert.equal((await this.token1.balanceOf(permanentVotingPower.address)).toString(), '0');
    });

    it('community fee should work properly for multihopBatchSwapExactOut', async () => {
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
      const token2PoolBalanceBefore = (await this.token2.balanceOf(pool.address)).toString();
      const token2AliceBalanceBefore = (await this.token2.balanceOf(alice)).toString();

      await this.bExchange.multihopBatchSwapExactOut(
        [
          [
            {
              pool: pool.address,
              tokenIn: this.token1.address,
              tokenOut: this.token2.address,
              swapAmount: expectedOutWithFee,
              limitReturnAmount: amountToSwap,
              maxPrice: mulScalarBN(price, ether('1.05')),
            },
          ],
        ],
        this.token1.address,
        this.token2.address,
        amountToSwap,
        { from: alice },
      );

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal((await this.token2.balanceOf(permanentVotingPower.address)).toString(), expectedOutFee);
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        addBN(token1PoolBalanceBefore, amountToSwap),
      );
      assert.equal(
        (await this.token2.balanceOf(pool.address)).toString(),
        subBN(token2PoolBalanceBefore, expectedOutWithFee),
      );
      assert.equal(
        (await this.token2.balanceOf(alice)).toString(),
        addBN(token2AliceBalanceBefore, subBN(expectedOutWithFee, expectedOutFee)).toString(),
      );
    });

    it('community fee should work properly for joinswapExternAmountIn and exitswapPoolAmountIn', async () => {
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

      await this.bActions.joinswapExternAmountIn(pool.address, this.token1.address, amountToSwap, poolAmountOut, {
        from: alice,
      });

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal(
        (await this.token1.balanceOf(permanentVotingPower.address)).toString(),
        amountCommunityJoinFee.toString(),
      );
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

      await pool.exitswapPoolAmountIn(this.token1.address, poolAmountOut, exitTokenAmountOut, { from: alice });

      const exitTokenAmountCommunityFee = mulScalarBN(exitTokenAmountOut, communityExitFee);
      const exitTokenAmountAfterCommunityFee = subBN(exitTokenAmountOut, exitTokenAmountCommunityFee);

      assert.equal((await this.token1.balanceOf(alice)).toString(), exitTokenAmountAfterCommunityFee);
      assert.equal(
        (await this.token1.balanceOf(permanentVotingPower.address)).toString(),
        addBN(amountCommunityJoinFee, exitTokenAmountCommunityFee),
      );
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        subBN(token1PoolBalanceBefore, exitTokenAmountOut),
      );
      assert.equal((await pool.balanceOf(alice)).toString(), '0');
    });

    it('community fee should work properly for joinPool and exitPool', async () => {
      const poolOutAmount = divScalarBN(
        mulScalarBN(amountToSwap, await pool.totalSupply()),
        await pool.getBalance(this.token1.address),
      );
      let ratio = divScalarBN(poolOutAmount, await pool.totalSupply());
      const token1InAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
      const token2InAmount = mulScalarBN(ratio, await pool.getBalance(this.token2.address));

      const poolOutAmountFee = mulScalarBN(poolOutAmount, communityJoinFee);
      const poolOutAmountAfterFee = subBN(poolOutAmount, poolOutAmountFee);

      await this.bActions.joinPool(pool.address, poolOutAmount, [token1InAmount, token2InAmount], { from: alice });

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal((await this.token2.balanceOf(alice)).toString(), '0');
      assert.equal((await pool.balanceOf(permanentVotingPower.address)).toString(), poolOutAmountFee.toString());
      assert.equal(await this.token1.balanceOf(pool.address), addBN(token1InAmount, balances[0]));
      assert.equal(await this.token2.balanceOf(pool.address), addBN(token2InAmount, balances[1]));
      assert.equal((await pool.balanceOf(alice)).toString(), poolOutAmountAfterFee.toString());

      const poolInAmountFee = mulScalarBN(poolOutAmountAfterFee, communityExitFee);
      const poolInAmountAfterFee = subBN(poolOutAmountAfterFee, poolInAmountFee);

      ratio = divScalarBN(poolInAmountAfterFee, await pool.totalSupply());
      const token1OutAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
      const token2OutAmount = mulScalarBN(ratio, await pool.getBalance(this.token2.address));

      await pool.exitPool(poolOutAmountAfterFee, [token1OutAmount, token2OutAmount], { from: alice });

      assertEqualWithAccuracy((await pool.balanceOf(alice)).toString(), '0');
      assertEqualWithAccuracy((await this.token1.balanceOf(alice)).toString(), token1OutAmount);
      assertEqualWithAccuracy((await this.token2.balanceOf(alice)).toString(), token2OutAmount);
      assertEqualWithAccuracy(
        (await pool.balanceOf(permanentVotingPower.address)).toString(),
        addBN(poolOutAmountFee, poolInAmountFee).toString(),
      );
      assertEqualWithAccuracy(
        await this.token1.balanceOf(pool.address),
        subBN(addBN(token1InAmount, balances[0]), token1OutAmount),
      );
      assertEqualWithAccuracy(
        await this.token2.balanceOf(pool.address),
        subBN(addBN(token2InAmount, balances[1]), token2OutAmount),
      );
    });

    it('community fee should be zero for address set to without fee restrictions', async () => {
      const poolRestrictions = await PoolRestrictions.new();
      await pool.setRestrictions(poolRestrictions.address, { from: minter });
      await poolRestrictions.setWithoutFee([alice], { from: minter });

      const expectedSwapOutWithoutFee = (
        await pool.calcOutGivenIn(balances[0], weights[0], balances[1], weights[1], amountToSwap, swapFee)
      ).toString(10);

      const price = (
        await pool.calcSpotPrice(
          addBN(balances[0], amountToSwap),
          weights[0],
          subBN(balances[1], expectedSwapOutWithoutFee),
          weights[1],
          swapFee,
        )
      ).toString(10);

      assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
      const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
      const token2AliceBalanceBefore = (await this.token2.balanceOf(alice)).toString();

      await this.token1.approve(pool.address, amountToSwap, { from: alice });

      await pool.swapExactAmountIn(
        this.token1.address,
        amountToSwap,
        this.token2.address,
        expectedSwapOutWithoutFee,
        mulScalarBN(price, ether('1.05')),
        { from: alice },
      );

      assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
      assert.equal((await this.token1.balanceOf(permanentVotingPower.address)).toString(), '0');
      assert.equal(
        (await this.token1.balanceOf(pool.address)).toString(),
        addBN(token1PoolBalanceBefore, amountToSwap),
      );

      assert.equal(
        (await this.token2.balanceOf(alice)).toString(),
        addBN(token2AliceBalanceBefore, expectedSwapOutWithoutFee).toString(),
      );
    });
  });

  it('pool restrictions should work properly', async () => {
    assert.equal((await pool.totalSupply()).toString(10), ether('100').toString(10));

    const poolRestrictions = await PoolRestrictions.new();
    await pool.setRestrictions(poolRestrictions.address, { from: minter });
    await poolRestrictions.setTotalRestrictions([pool.address], [ether('200').toString(10)], { from: minter });

    let amountToMint = ether('50').toString(10);

    let [token1Amount, token2Amount] = await this.getTokensToJoinPoolAndApprove(pool, amountToMint);

    await this.bActions.joinPool(pool.address, amountToMint, [token1Amount, token2Amount]);

    assert.equal((await pool.totalSupply()).toString(10), ether('150').toString(10));

    amountToMint = ether('60').toString(10);

    [token1Amount, token2Amount] = await this.getTokensToJoinPoolAndApprove(pool, amountToMint);

    await expectRevert(this.bActions.joinPool(pool.address, amountToMint, [token1Amount, token2Amount]), 'MAX_SUPPLY');
  });

  it('controller should be able to call any voting contract by pool', async () => {
    const poolRestrictions = await PoolRestrictions.new();
    await pool.setRestrictions(poolRestrictions.address, { from: minter });

    assert.equal(await this.token1.delegated(pool.address, pool.address), '0');

    const delegateData = this.token1.contract.methods.delegate(pool.address).encodeABI();
    const delegateSig = delegateData.slice(0, 10);
    await expectRevert(
      pool.callVoting(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', { from: minter }),
      'NOT_ALLOWED_SIG',
    );
    await poolRestrictions.setVotingSignaturesForAddress(this.token1.address, true, [delegateSig], [true], {
      from: minter,
    });

    await expectRevert(
      pool.callVoting(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', { from: alice }),
      'NOT_CONTROLLER',
    );

    await pool.callVoting(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', { from: minter });

    assert.equal(
      (await this.token1.delegated(pool.address, pool.address)).toString(10),
      (await this.token1.balanceOf(pool.address)).toString(10),
    );

    await poolRestrictions.setVotingSignaturesForAddress(this.token1.address, false, [delegateSig], [false], {
      from: minter,
    });
    await expectRevert(
      pool.callVoting(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', { from: minter }),
      'NOT_ALLOWED_SIG',
    );

    const voting = await MockVoting.new(tokens[0]);
    let proposalReceiptBefore = await voting.getReceipt('1', pool.address);
    assert.equal(proposalReceiptBefore.hasVoted, false);

    const castVoteData = voting.contract.methods.castVote('1', true).encodeABI();
    const castVoteSig = castVoteData.slice(0, 10);
    await expectRevert(
      pool.callVoting(voting.address, castVoteSig, '0x' + castVoteData.slice(10), '0', { from: minter }),
      'NOT_ALLOWED_SIG',
    );
    await poolRestrictions.setVotingSignatures([castVoteSig], [true], { from: minter });

    await pool.callVoting(voting.address, castVoteSig, '0x' + castVoteData.slice(10), '0', { from: minter });

    let proposalReceiptAfter = await voting.getReceipt('1', pool.address);
    assert.equal(proposalReceiptAfter.hasVoted, true);

    const newCastVoteData = voting.contract.methods.castVote('2', true).encodeABI();
    assert.equal(newCastVoteData.slice(0, 10), castVoteSig);

    proposalReceiptBefore = await voting.getReceipt('2', pool.address);
    assert.equal(proposalReceiptBefore.hasVoted, false);

    await poolRestrictions.setVotingSignaturesForAddress(voting.address, true, [castVoteSig], [false], {
      from: minter,
    });
    await expectRevert(
      pool.callVoting(voting.address, castVoteSig, '0x' + newCastVoteData.slice(10), '0', { from: minter }),
      'NOT_ALLOWED_SIG',
    );

    await poolRestrictions.setVotingSignaturesForAddress(voting.address, false, [castVoteSig], [false], {
      from: minter,
    });
    await pool.callVoting(voting.address, castVoteSig, '0x' + newCastVoteData.slice(10), '0', { from: minter });

    proposalReceiptAfter = await voting.getReceipt('2', pool.address);
    assert.equal(proposalReceiptAfter.hasVoted, true);

    await expectRevert(
      pool.callVoting(voting.address, castVoteSig, '0x' + newCastVoteData.slice(10), '0', { from: minter }),
      'NOT_SUCCESS',
    );
  });

  describe('PoolController', () => {
    let poolController;
    beforeEach(async () => {
      poolController = await PowerIndexPoolController.new(pool.address, zeroAddress);
      await pool.setController(poolController.address);
    });

    it('should be able to callPool by controller owner', async () => {
      const setSwapFeeSig = pool.contract._jsonInterface.filter(item => item.name === 'setSwapFee')[0].signature;
      const setSwapFeeArgs = web3.eth.abi.encodeParameters(['uint256'], [ether('0.005').toString()]);
      await expectRevert(
        poolController.callPool(setSwapFeeSig, setSwapFeeArgs, '0', { from: alice }),
        'Ownable: caller is not the owner',
      );

      const setSwapFeeArgsIncorrect = web3.eth.abi.encodeParameters(['uint256'], [ether('5').toString()]);
      await expectRevert(
        poolController.callPool(setSwapFeeSig, setSwapFeeArgsIncorrect, '0', { from: minter }),
        'NOT_SUCCESS',
      );

      await poolController.callPool(setSwapFeeSig, setSwapFeeArgs, '0', { from: minter });
      assert.equal(await pool.getSwapFee(), ether('0.005').toString());
    });

    it('callVotingByPool should work properly', async () => {
      const poolRestrictions = await PoolRestrictions.new();

      const setRestrictionsSig = pool.contract._jsonInterface.filter(item => item.name === 'setRestrictions')[0]
        .signature;
      const setRestrictionsArgs = web3.eth.abi.encodeParameters(['address'], [poolRestrictions.address]);
      await poolController.callPool(setRestrictionsSig, setRestrictionsArgs, '0', { from: minter });
      assert.equal(await pool.getController(), poolController.address);

      assert.equal(await this.token1.delegated(pool.address, pool.address), '0');

      const delegateData = this.token1.contract.methods.delegate(pool.address).encodeABI();
      const delegateSig = delegateData.slice(0, 10);
      await expectRevert(
        poolController.callVotingByPool(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', {
          from: minter,
        }),
        'SENDER_NOT_ALLOWED',
      );

      const callVotingSig = pool.contract._jsonInterface.filter(item => item.name === 'callVoting')[0].signature;
      const callVotingArgs = web3.eth.abi.encodeParameters(
        ['address', 'bytes4', 'bytes', 'uint256'],
        [this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0'],
      );
      await expectRevert(
        poolController.callPool(callVotingSig, callVotingArgs, '0', { from: minter }),
        'SIGNATURE_NOT_ALLOWED',
      );

      await poolRestrictions.setVotingAllowedForSenders(this.token1.address, [minter], [true], { from: minter });

      await expectRevert(
        poolController.callVotingByPool(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', {
          from: minter,
        }),
        'NOT_ALLOWED_SIG',
      );

      await poolRestrictions.setVotingSignaturesForAddress(this.token1.address, true, [delegateSig], [true], {
        from: minter,
      });

      await expectRevert(
        poolController.callVotingByPool(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', {
          from: alice,
        }),
        'SENDER_NOT_ALLOWED',
      );

      await poolController.callVotingByPool(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', {
        from: minter,
      });

      assert.equal(
        (await this.token1.delegated(pool.address, pool.address)).toString(10),
        (await this.token1.balanceOf(pool.address)).toString(10),
      );
    });

    it('migrateController should work properly', async () => {
      const bPoolWrapper = await PowerIndexWrapper.new(pool.address);
      await bPoolWrapper.setController(poolController.address);

      assert.equal(await bPoolWrapper.getController(), poolController.address);
      assert.equal(await pool.getController(), poolController.address);

      await expectRevert(
        poolController.migrateController(minter, [pool.address, bPoolWrapper.address], { from: alice }),
        'Ownable: caller is not the owner',
      );

      await poolController.migrateController(minter, [pool.address, bPoolWrapper.address], { from: minter });

      assert.equal(await bPoolWrapper.getController(), minter);
      assert.equal(await pool.getController(), minter);

      await expectRevert(poolController.migrateController(minter, [pool.address], { from: minter }), 'NOT_CONTROLLER');
      await expectRevert(
        poolController.migrateController(minter, [bPoolWrapper.address], { from: minter }),
        'NOT_CONTROLLER',
      );
    });
  });
});
