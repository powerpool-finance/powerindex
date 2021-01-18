const { expectRevert, expectEvent, time, constants } = require('@openzeppelin/test-helpers');
const { ether } = require('./helpers');
const { buildBasicRouterConfig } = require('./helpers/builders');
const assert = require('chai').assert;
const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const MockERC20 = artifacts.require('MockERC20');
const MockCvp = artifacts.require('MockCvp');
const WETH = artifacts.require('MockWETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const PowerIndexWrapper = artifacts.require('PowerIndexWrapper');
const WrappedPiErc20Factory = artifacts.require('WrappedPiErc20Factory');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const MockErc20Migrator = artifacts.require('MockErc20Migrator');
const PowerIndexRouter = artifacts.require('PowerIndexBasicRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const BasicPowerIndexRouterFactory = artifacts.require('BasicPowerIndexRouterFactory');

MockERC20.numberFormat = 'String';
MockErc20Migrator.numberFormat = 'String';
PowerIndexPool.numberFormat = 'String';
PowerIndexPoolController.numberFormat = 'String';
PowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

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

function assertEqualWithAccuracy(bn1, bn2, message, accuracyWei = '30') {
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

describe('PowerIndexPoolController', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const name = 'My Pool';
  const symbol = 'MP';
  const balances = [ether('10'), ether('20')];
  const weights = [ether('25'), ether('25')];
  const swapFee = ether('0.01').toString();
  const communitySwapFee = ether('0.05').toString();
  const communityJoinFee = ether('0.04').toString();
  const communityExitFee = ether('0.07').toString();

  let tokens;
  let pool;
  let poolWrapper;
  let controller;
  let wrapperFactory;
  let routerFactory;
  let defaultBasicConfig;
  let defaultFactoryArgs;

  let minter, alice, communityWallet, stub, weightsStrategy;
  let amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut;
  const minWeightPerSecond = ether('0.00000001').toString();
  const maxWeightPerSecond = ether('0.1').toString();

  before(async function () {
    [minter, alice, communityWallet, stub, weightsStrategy] = await web3.eth.getAccounts();
    const poolRestrictions = await PoolRestrictions.new();
    defaultBasicConfig = buildBasicRouterConfig(
      poolRestrictions.address,
      constants.ZERO_ADDRESS,
      constants.ZERO_ADDRESS,
      ether(0),
      '0',
      stub,
      ether(0),
      []
    );
    defaultFactoryArgs = web3.eth.abi.encodeParameter({
      BasicConfig: {
        poolRestrictions: 'address',
        voting: 'address',
        staking: 'address',
        reserveRatio: 'uint256',
        rebalancingInterval: 'uint256',
        pvp: 'address',
        pvpFee: 'uint256',
        rewardPools: 'address[]',
      }
    }, defaultBasicConfig);
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

    await time.increase(11000);

    poolWrapper = await PowerIndexWrapper.new(pool.address);
    wrapperFactory = await WrappedPiErc20Factory.new();
    controller = await PowerIndexPoolController.new(pool.address, zeroAddress, wrapperFactory.address, weightsStrategy);
    routerFactory = await BasicPowerIndexRouterFactory.new();

    await pool.setWrapper(poolWrapper.address, true);
    await pool.setController(controller.address);
    await poolWrapper.setController(controller.address);
    await controller.setPoolWrapper(poolWrapper.address);

    await time.increase(60);

    this.getTokensToJoinPoolAndApprove = async amountToMint => {
      const poolTotalSupply = (await pool.totalSupply()).toString(10);
      const ratio = divScalarBN(amountToMint, poolTotalSupply);
      const token1Amount = mulScalarBN(ratio, (await pool.getBalance(this.token1.address)).toString(10));
      const token2Amount = mulScalarBN(ratio, (await pool.getBalance(this.token2.address)).toString(10));
      await this.token1.approve(poolWrapper.address, token1Amount);
      await this.token2.approve(poolWrapper.address, token2Amount);
      return [token1Amount, token2Amount];
    };

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
      await pool.calcOutGivenIn(balances[0], weights[0], balances[1], weights[1], amountAfterCommunitySwapFee, swapFee)
    ).toString(10);
  });

  it('setDynamicWeightListByStrategy should work properly', async () => {
    const dwArg = {
      token: this.token2.address,
      targetDenorm: ether('15').toString(),
      fromTimestamp: await getTimestamp(100),
      targetTimestamp: await getTimestamp(10000),
    };

    await expectRevert(
      controller.setDynamicWeightListByStrategy([dwArg], {from: minter}),
      'ONLY_WEIGHTS_STRATEGY'
    );

    await controller.setDynamicWeightListByStrategy([dwArg], {from: weightsStrategy});

    const dw = await pool.getDynamicWeightSettings(this.token2.address);
    assert.equal(dw.fromTimestamp, dwArg.fromTimestamp);
    assert.equal(dw.targetTimestamp, dwArg.targetTimestamp);
    assert.equal(dw.targetDenorm, dwArg.targetDenorm);

    await expectRevert(controller.setWeightsStrategy(alice, {from: weightsStrategy}), 'Ownable: caller is not the owner');

    await controller.setWeightsStrategy(alice, {from: minter});
    assert.equal(await controller.weightsStrategy(), alice);

    await expectRevert(controller.setDynamicWeightListByStrategy([dwArg], {from: weightsStrategy}), 'ONLY_WEIGHTS_STRATEGY');
  });

  it('should allow swapping a token with a new version', async () => {
    this.token3 = await MockERC20.new('My Token 3', 'MT3', '18', ether('1000000'));
    this.migrator = await MockErc20Migrator.new(this.token2.address, this.token3.address, alice);
    const amount = await pool.getBalance(this.token2.address);
    await this.token3.transfer(this.migrator.address, ether('1000000'));
    const migratorData = this.migrator.contract.methods.migrate(controller.address, amount).encodeABI();

    const res = await controller.replacePoolTokenWithNewVersion(
      this.token2.address,
      this.token3.address,
      this.migrator.address,
      migratorData,
    );
    expectEvent(res, 'ReplacePoolTokenWithNewVersion', {
      oldToken: this.token2.address,
      newToken: this.token3.address,
      migrator: this.migrator.address,
      balance: ether('20'),
      denormalizedWeight: ether('25'),
    });

    await time.increase(60);
    await controller.finishReplace();

    const price = (
      await pool.calcSpotPrice(
        addBN(balances[0], amountToSwap),
        weights[0],
        subBN(balances[1], expectedSwapOut),
        weights[1],
        swapFee,
      )
    ).toString(10);

    assert.equal(await this.token1.balanceOf(alice), amountToSwap);
    const token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);
    const token3AliceBalanceBefore = await this.token3.balanceOf(alice);

    await this.token1.approve(poolWrapper.address, amountToSwap, { from: alice });
    // TODO: A wrong error message due probably the Buidler EVM bug
    await expectRevert(
      poolWrapper.swapExactAmountIn(
        this.token1.address,
        amountToSwap,
        this.token2.address,
        expectedSwapOut,
        mulScalarBN(price, ether('1.05')),
        { from: alice },
      ),
      'NOT_BOUND',
    );

    await poolWrapper.swapExactAmountIn(
      this.token1.address,
      amountToSwap,
      this.token3.address,
      expectedSwapOut,
      mulScalarBN(price, ether('1.05')),
      { from: alice },
    );

    assert.equal(await this.token1.balanceOf(alice), '0');
    assert.equal(
      await this.token1.balanceOf(pool.address),
      addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee),
    );

    assert.equal(await this.token3.balanceOf(alice), addBN(token3AliceBalanceBefore, expectedSwapOut));
  });

  it('should allow swapping a token with a new wrapped version', async () => {
    let res = await controller.replacePoolTokenWithNewPiToken(this.token2.address, routerFactory.address, defaultFactoryArgs, 'WrappedTKN2', 'WTKN2');
    const wToken2 = await WrappedPiErc20.at(res.logs.filter(l => l.event === 'ReplacePoolTokenWithPiToken')[0].args.piToken);

    await time.increase(60);
    await controller.finishReplace();

    await expectEvent.inTransaction(res.tx, BasicPowerIndexRouterFactory, 'BuildBasicRouter', {
      builder: controller.address
    });
    expectEvent(res, 'ReplacePoolTokenWithPiToken', {
      underlyingToken: this.token2.address,
      piToken: wToken2.address,
      balance: ether('20'),
      denormalizedWeight: ether('25'),
    });

    const price = (
      await pool.calcSpotPrice(
        addBN(balances[0], amountToSwap),
        weights[0],
        subBN(balances[1], expectedSwapOut),
        weights[1],
        swapFee,
      )
    ).toString(10);

    assert.equal(await this.token1.balanceOf(alice), amountToSwap);
    const token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);
    const token2AliceBalanceBefore = await this.token2.balanceOf(alice);

    await this.token1.approve(poolWrapper.address, amountToSwap, { from: alice });

    await poolWrapper.swapExactAmountIn(
      this.token1.address,
      amountToSwap,
      this.token2.address,
      expectedSwapOut,
      mulScalarBN(price, ether('1.05')),
      { from: alice },
    );

    assert.equal(await this.token1.balanceOf(alice), '0');
    assert.equal(
      await this.token1.balanceOf(pool.address),
      addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee),
    );

    assert.equal(
      await this.token2.balanceOf(alice),
      addBN(token2AliceBalanceBefore, expectedSwapOut),
    );
  });

  it('should allow swapping a token with existing wrapped version', async () => {
    let res = await wrapperFactory.build(this.token2.address, stub, 'WrappedTKN2', 'WTKN2');
    const wToken2 = await WrappedPiErc20.at(res.logs[0].args.wrappedToken);
    const router = await PowerIndexRouter.new(wToken2.address, defaultBasicConfig);
    wToken2.changeRouter(router.address, { from: stub });

    res = await controller.replacePoolTokenWithExistingPiToken(this.token2.address, wToken2.address);
    expectEvent(res, 'ReplacePoolTokenWithPiToken', {
      underlyingToken: this.token2.address,
      piToken: wToken2.address,
      balance: ether('20'),
      denormalizedWeight: ether('25'),
    });

    await time.increase(60);
    await controller.finishReplace();

    const price = (
      await pool.calcSpotPrice(
        addBN(balances[0], amountToSwap),
        weights[0],
        subBN(balances[1], expectedSwapOut),
        weights[1],
        swapFee,
      )
    ).toString(10);

    assert.equal(await this.token1.balanceOf(alice), amountToSwap);
    const token1PoolBalanceBefore = await this.token1.balanceOf(pool.address);
    const token2AliceBalanceBefore = await this.token2.balanceOf(alice);

    await this.token1.approve(poolWrapper.address, amountToSwap, { from: alice });

    await poolWrapper.swapExactAmountIn(
      this.token1.address,
      amountToSwap,
      this.token2.address,
      expectedSwapOut,
      mulScalarBN(price, ether('1.05')),
      { from: alice },
    );

    assert.equal(await this.token1.balanceOf(alice), '0');
    assert.equal(
      await this.token1.balanceOf(pool.address),
      addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee),
    );

    assert.equal(
      await this.token2.balanceOf(alice),
      addBN(token2AliceBalanceBefore, expectedSwapOut),
    );
  });

  it('should allow making a wrapped token join and exit', async () => {
    let res = await controller.replacePoolTokenWithNewPiToken(this.token2.address, routerFactory.address, defaultFactoryArgs, 'WrappedTKN2', 'WTKN2');
    const wToken2 = await WrappedPiErc20.at(res.logs.filter(l => l.event === 'ReplacePoolTokenWithPiToken')[0].args.piToken);
    assert.equal(await wToken2.balanceOf(pool.address), ether('20'));
    assert.equal(await pool.isBound(this.token2.address), false);
    assert.equal(await pool.isBound(wToken2.address), true);

    await time.increase(60);
    await controller.finishReplace();

    const poolOutAmount = divScalarBN(
      mulScalarBN(amountToSwap, await pool.totalSupply()),
      await pool.getBalance(this.token1.address),
    );
    let ratio = divScalarBN(poolOutAmount, await pool.totalSupply());
    const token1InAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
    const token2InAmount = mulScalarBN(ratio, await pool.getBalance(wToken2.address));

    const poolOutAmountFee = mulScalarBN(poolOutAmount, communityJoinFee);
    const poolOutAmountAfterFee = subBN(poolOutAmount, poolOutAmountFee);

    await expectRevert(pool.joinPool(poolOutAmount, [token1InAmount, token2InAmount], { from: alice }), 'ONLY_WRAPPER');

    await this.token2.approve(poolWrapper.address, ether(token2InAmount), { from: alice });
    await poolWrapper.joinPool(poolOutAmount, [token1InAmount, token2InAmount], { from: alice });

    assert.equal(await this.token1.balanceOf(alice), '0');
    assert.equal(await this.token2.balanceOf(alice), '0');
    assert.equal(await this.token1.balanceOf(pool.address), addBN(token1InAmount, balances[0]));
    assert.equal(await wToken2.balanceOf(pool.address), addBN(token2InAmount, balances[1]));
    assert.equal(await pool.balanceOf(alice), poolOutAmountAfterFee);

    const poolInAmountFee = mulScalarBN(poolOutAmountAfterFee, communityExitFee);
    const poolInAmountAfterFee = subBN(poolOutAmountAfterFee, poolInAmountFee);

    ratio = divScalarBN(poolInAmountAfterFee, await pool.totalSupply());
    const token1OutAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
    const token2OutAmount = mulScalarBN(ratio, await pool.getBalance(wToken2.address));

    await pool.approve(poolWrapper.address, poolOutAmountAfterFee, { from: alice });

    await expectRevert(
      pool.exitPool(poolOutAmountAfterFee, [token1OutAmount, token2OutAmount], { from: alice }),
      'ONLY_WRAPPER',
    );

    await poolWrapper.exitPool(poolOutAmountAfterFee, [token1OutAmount, token2OutAmount], { from: alice });

    assertEqualWithAccuracy(await pool.balanceOf(alice), '0');
    assertEqualWithAccuracy(await this.token1.balanceOf(alice), token1OutAmount);
    assertEqualWithAccuracy(await this.token2.balanceOf(alice), token2OutAmount);
    assertEqualWithAccuracy(
      await this.token1.balanceOf(pool.address),
      subBN(addBN(token1InAmount, balances[0]), token1OutAmount),
    );
    assertEqualWithAccuracy(
      await wToken2.balanceOf(pool.address),
      subBN(addBN(token2InAmount, balances[1]), token2OutAmount),
    );
  });
});
