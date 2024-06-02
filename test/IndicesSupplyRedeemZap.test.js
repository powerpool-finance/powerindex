const fs = require('fs');
const { deployProxied, mwei, addBN, subBN, mulBN, divBN, assertEqualWithAccuracy } = require('./helpers');

const { time, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const MockERC20 = artifacts.require('MockERC20');
const UniswapV2Factory = artifacts.require('MockUniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
const WETH = artifacts.require('MockWETH');
const EthPiptSwap = artifacts.require('EthPiptSwap');
const Erc20PiptSwap = artifacts.require('Erc20PiptSwap');
const Erc20VaultPoolSwap = artifacts.require('Erc20VaultPoolSwap');
const ProxyFactory = artifacts.require('ProxyFactory');
const IndicesSupplyRedeemZap = artifacts.require('IndicesSupplyRedeemZap');
const MockPoke = artifacts.require('MockPoke');
const MockVault = artifacts.require('MockVault');
const MockCurveDepositor2 = artifacts.require('MockCurveDepositor2');
const MockCurveDepositor3 = artifacts.require('MockCurveDepositor3');
const MockCurveDepositor4 = artifacts.require('MockCurveDepositor4');
const MockCurvePoolRegistry = artifacts.require('MockCurvePoolRegistry');

WETH.numberFormat = 'String';
MockERC20.numberFormat = 'String';
UniswapV2Pair.numberFormat = 'String';
UniswapV2Router02.numberFormat = 'String';
EthPiptSwap.numberFormat = 'String';
Erc20PiptSwap.numberFormat = 'String';
PowerIndexPool.numberFormat = 'String';
IndicesSupplyRedeemZap.numberFormat = 'String';

const { web3 } = PowerIndexPoolFactory;

function ether(val) {
  return web3.utils.toWei(val.toString(), 'ether');
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

describe('IndicesSupplyRedeemZap', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  let ETH;
  const swapFee = ether('0.0001');
  const communitySwapFee = ether('0.001');
  const communityJoinFee = ether('0.001');
  const communityExitFee = ether('0.001');

  const poolsData = JSON.parse(fs.readFileSync('data/poolsData.json', { encoding: 'utf8' }));

  const roundPeriod = 60 * 60;
  const slasherInterval = 15 * 60;

  let minter, alice, bob, dan, carol, reporter, slasher, feeManager, permanentVotingPower;
  before(async function () {
    [minter, alice, bob, dan, carol, reporter, slasher, feeManager, permanentVotingPower] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();
    await this.weth.deposit({ value: ether('50000000') });

    this.poke = await MockPoke.new(false);
    await this.poke.setMinMaxReportIntervals(0, slasherInterval);
    await this.poke.setReporter('1', reporter, true);
    await this.poke.setSlasher('2', slasher, true);

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

    this.getPairAmountOut = async (_pair, _amountIn, _inWeth = true) => {
      const reserves = await _pair.getReserves();
      return this.uniswapRouter.getAmountOut(
        _amountIn,
        _inWeth ? reserves[1].toString(10) : reserves[0].toString(10),
        _inWeth ? reserves[0].toString(10) : reserves[1].toString(10),
      );
    };

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
      return PowerIndexPool.at(logNewPool.args.pool);
    };

    this.makeUniswapPair = async (_token, _tokenBalance, _wethBalance, isReverse) => {
      const token0 = isReverse ? this.weth.address : _token.address;
      const token1 = isReverse ? _token.address : this.weth.address;
      const res = await this.uniswapFactory.createPairMock(token0, token1);
      const pair = await UniswapV2Pair.at(res.logs[0].args.pair);
      await _token.transfer(pair.address, _tokenBalance);
      await this.weth.transfer(pair.address, _wethBalance);
      await pair.mint(minter);
      return pair;
    };
  });

  describe('Supply and Redeem of PIPT pool', () => {
    let cvp, usdc, tokens, balancerTokens, pairs, bPoolBalances, pool;

    const tokenBySymbol = {};

    beforeEach(async () => {
      tokens = [];
      balancerTokens = [];
      pairs = [];
      bPoolBalances = [];

      for (let i = 0; i < poolsData.length; i++) {
        const token = await MockERC20.new(poolsData[i].tokenSymbol, poolsData[i].tokenSymbol, poolsData[i].tokenDecimals, ether('10000000000'));

        const pair = await this.makeUniswapPair(
          token,
          poolsData[i].uniswapPair.tokenReserve,
          poolsData[i].uniswapPair.ethReserve,
          poolsData[i].uniswapPair.isReverse,
        );
        tokens.push(token);
        pairs.push(pair);
        bPoolBalances.push(poolsData[i].balancerBalance);
        if (poolsData[i].tokenSymbol === 'CVP') {
          cvp = token;
        }
        if (poolsData[i].tokenSymbol === 'USDC') {
          usdc = token;
        }

        tokenBySymbol[poolsData[i].tokenSymbol] = {
          token,
          pair
        };
      }

      balancerTokens = tokens.filter((t, i) => poolsData[i].balancerBalance !== '0');

      pool = await this.makePowerIndexPool(balancerTokens, bPoolBalances.filter(b => b !== '0'));

      this.indiciesZap = await deployProxied(
        IndicesSupplyRedeemZap,
        [usdc.address, this.poke.address],
        [roundPeriod],
        {proxyAdminOwner: minter}
      );

      ETH = await this.indiciesZap.ETH();

      await time.increase(12 * 60 * 60);
    });

    it('should deposit, withdraw, supply, redeem and claim correctly', async () => {
      const aliceEthToSwap = ether(10);
      const bobEthToSwap = ether(20);

      const danUsdcToSwap = ether(5000);
      const carolUsdcToSwap = ether(10000);
      const usdcTokenCap = ether(11000);

      const erc20PiptSwap = await Erc20PiptSwap.new(this.weth.address, usdc.address, cvp.address, pool.address, zeroAddress, feeManager, {
        from: minter,
      });

      await erc20PiptSwap.fetchUnswapPairsFromFactory(
        this.uniswapFactory.address,
        this.weth.address,
        tokens.map(t => t.address),
        '0',
        { from: minter },
      );

      await erc20PiptSwap.setTokensSettings(
        tokens.map(t => t.address),
        pairs.map(p => p.address),
        this.weth.address,
        pairs.map(() => true),
        '0',
        { from: minter },
      );

      await this.indiciesZap.setPools([pool.address], ['1'], {from: minter});
      await this.indiciesZap.setPoolsSwapContracts([pool.address], [erc20PiptSwap.address], {from: minter});
      await this.indiciesZap.setTokensCap([usdc.address], [usdcTokenCap], {from: minter});

      await expectRevert(this.indiciesZap.depositEth(pool.address, { value: '0', from: alice }), 'NA');
      let res = await this.indiciesZap.depositEth(pool.address, { value: aliceEthToSwap, from: alice });

      await expectRevert(this.indiciesZap.withdrawEth(pool.address, '0', { from: alice }), 'NA');
      await expectRevert(this.indiciesZap.withdrawEth(alice, '0', { from: alice }), 'NS_POOL');

      const firstRoundEthKey = await this.indiciesZap.getRoundKey(res.receipt.blockNumber, pool.address, ETH, pool.address);
      let endTime = await web3.eth.getBlock(res.receipt.blockNumber).then(b => (b.timestamp + roundPeriod).toString());
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound');
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound', {
        key: firstRoundEthKey,
        endTime,
        pool: pool.address,
        inputToken: ETH,
        outputToken: pool.address
      });

      let round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.startBlock, res.receipt.blockNumber);
      assert.equal(round.endTime, endTime);
      assert.equal(round.pool, pool.address);
      assert.equal(round.inputToken, ETH);
      assert.equal(round.outputToken, pool.address);
      assert.equal(round.totalInputAmount, aliceEthToSwap);
      assert.equal(round.totalOutputAmount, '0');

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, alice), aliceEthToSwap);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, bob), '0');

      await expectRevert(this.indiciesZap.depositErc20(pool.address, usdc.address, '0', { from: alice }), 'NA');
      await expectRevert(this.indiciesZap.depositErc20(pool.address, await this.indiciesZap.ETH(), ether(10), { from: alice }), 'NS_TOKEN');
      await expectRevert(this.indiciesZap.depositErc20(pool.address, alice, ether(10), { from: alice }), 'NS_TOKEN');

      await expectRevert(this.indiciesZap.depositEth(pool.address, { value: '1', from: bob }), 'MIN_INPUT');

      res = await this.indiciesZap.depositEth(pool.address, { value: bobEthToSwap, from: bob });
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound');
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound');

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, alice), aliceEthToSwap);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, bob), bobEthToSwap);

      const totalEthToSwap = addBN(aliceEthToSwap, bobEthToSwap);

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.totalInputAmount, totalEthToSwap);
      assert.equal(round.totalOutputAmount, '0');

      await usdc.transfer(dan, mulBN(danUsdcToSwap, '2'), {from: minter});
      await usdc.approve(this.indiciesZap.address, mulBN(danUsdcToSwap, '2'), {from: dan});
      await usdc.transfer(carol, carolUsdcToSwap, {from: minter});
      await usdc.approve(this.indiciesZap.address, carolUsdcToSwap, {from: carol});

      res = await this.indiciesZap.depositErc20(pool.address, usdc.address, mulBN(danUsdcToSwap, '2'), { from: dan });
      const firstRoundUsdcKey = await this.indiciesZap.getRoundKey(res.receipt.blockNumber, pool.address, usdc.address, pool.address);
      assert.notEqual(firstRoundEthKey, firstRoundUsdcKey);
      endTime = await web3.eth.getBlock(res.receipt.blockNumber).then(b => (b.timestamp + roundPeriod).toString());
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound');
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound', {
        endTime,
        key: firstRoundUsdcKey,
        pool: pool.address,
        inputToken: usdc.address,
        outputToken: pool.address
      });

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.endTime, endTime);
      assert.equal(round.startBlock, res.receipt.blockNumber);
      assert.equal(round.pool, pool.address);
      assert.equal(round.inputToken, usdc.address);
      assert.equal(round.outputToken, pool.address);
      assert.equal(round.totalInputAmount, mulBN(danUsdcToSwap, '2'));

      await expectRevert(this.indiciesZap.withdrawErc20(pool.address, usdc.address, '0', { from: carol }), 'NA');
      await expectRevert(this.indiciesZap.withdrawErc20(pool.address, usdc.address, mulBN(danUsdcToSwap, '3'), { from: dan }), 'subtraction overflow');
      await expectRevert(this.indiciesZap.withdrawErc20(pool.address, usdc.address, danUsdcToSwap, { from: alice }), 'subtraction overflow');

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, dan), '0');
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundUsdcKey, dan), mulBN(danUsdcToSwap, '2'));

      res = await this.indiciesZap.withdrawErc20(pool.address, usdc.address, danUsdcToSwap, { from: dan });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'Withdraw', {
        roundKey: firstRoundUsdcKey,
        pool: pool.address,
        user: dan,
        inputToken: usdc.address,
        inputAmount: danUsdcToSwap
      });
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound');
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound');

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, danUsdcToSwap);

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, dan), '0');
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundUsdcKey, dan), danUsdcToSwap);

      assert.equal(await this.indiciesZap.isRoundReadyToExecute(firstRoundUsdcKey), false);

      const totalUsdcToSwap = addBN(danUsdcToSwap, carolUsdcToSwap);

      res = await this.indiciesZap.depositErc20(pool.address, usdc.address, carolUsdcToSwap, { from: carol });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'Deposit', {
        roundKey: firstRoundUsdcKey,
        pool: pool.address,
        user: carol,
        inputToken: usdc.address,
        inputAmount: carolUsdcToSwap
      });

      await usdc.approve(this.indiciesZap.address, danUsdcToSwap, {from: dan});
      res = await this.indiciesZap.depositErc20(pool.address, usdc.address, danUsdcToSwap, { from: dan });

      const secondRoundUsdcKey = await this.indiciesZap.getRoundKey(res.receipt.blockNumber, pool.address, usdc.address, pool.address);
      endTime = await web3.eth.getBlock(res.receipt.blockNumber).then(b => (b.timestamp + roundPeriod).toString());
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound', {
        endTime,
        key: secondRoundUsdcKey,
        pool: pool.address,
        inputToken: usdc.address,
        outputToken: pool.address
      });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound', {
        key: firstRoundUsdcKey,
        pool: pool.address,
        inputToken: usdc.address,
        totalInputAmount: totalUsdcToSwap,
        inputCap: usdcTokenCap
      });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'Deposit', {
        roundKey: secondRoundUsdcKey,
        pool: pool.address,
        user: dan,
        inputToken: usdc.address,
        inputAmount: danUsdcToSwap
      });

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.endTime, await web3.eth.getBlock(res.receipt.blockNumber).then(b => b.timestamp.toString()));

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, addBN(carolUsdcToSwap, danUsdcToSwap));
      assert.equal(await this.indiciesZap.tokenCap(usdc.address), usdcTokenCap);
      assert.equal(await this.indiciesZap.isRoundReadyToExecute(firstRoundUsdcKey), true);

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, carol), '0');
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundUsdcKey, carol), carolUsdcToSwap);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundUsdcKey, dan), danUsdcToSwap);

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, totalUsdcToSwap);

      assert.equal(await this.indiciesZap.isRoundReadyToExecute(firstRoundEthKey), false);

      await time.increase(roundPeriod);

      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [], '0x', {from: reporter}), 'L');
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [alice, bob], '0x', {from: reporter}), 'NULL_TO');
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundUsdcKey, [dan, carol], '0x', {from: reporter}), 'NULL_TO');

      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [], '0x', {from: reporter}), 'L');

      assert.equal(await this.indiciesZap.isRoundReadyToExecute(firstRoundEthKey), true);

      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [firstRoundEthKey], '0x', {from: dan}), 'NOT_HDH');
      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [firstRoundEthKey], '0x', {from: slasher}), 'NOT_HDH');
      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromReporter('2', [firstRoundEthKey], '0x', {from: reporter}), 'NOT_HDH');

      res = await this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [firstRoundEthKey], '0x', {from: reporter});
      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [firstRoundEthKey], '0x', {from: reporter}), 'TO_NOT_NULL');
      const secondRoundEthKey = await this.indiciesZap.getRoundKey(res.receipt.blockNumber, pool.address, ETH, pool.address);
      endTime = await web3.eth.getBlock(res.receipt.blockNumber).then(b => (b.timestamp + roundPeriod).toString());
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound', {
        endTime,
        key: secondRoundEthKey,
        pool: pool.address,
        inputToken: ETH,
        outputToken: pool.address
      });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound', {
        key: firstRoundEthKey,
        pool: pool.address,
        inputToken: ETH,
        totalInputAmount: totalEthToSwap,
        inputCap: '0',
        finishEndTime: await web3.eth.getBlock(res.receipt.blockNumber).then(b => b.timestamp.toString())
      });

      const { ethAfterFee: ethInAfterFee } = await erc20PiptSwap.calcEthFee(totalEthToSwap);
      const {poolOut: poolOutForEth} = await erc20PiptSwap.calcSwapEthToPiptInputs(
        ethInAfterFee,
        balancerTokens.map(t => t.address),
        await erc20PiptSwap.defaultSlippage(),
      );

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assertEqualWithAccuracy(round.totalOutputAmount, poolOutForEth, ether('0.05'));

      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'SupplyAndRedeemPoke', {
        roundKey: firstRoundEthKey,
        pool: pool.address,
        inputToken: ETH,
        outputToken: pool.address,
        totalInputAmount: totalEthToSwap,
        totalOutputAmount: round.totalOutputAmount
      });

      assert.equal(await pool.balanceOf(alice), '0');
      assert.equal(await pool.balanceOf(bob), '0');

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalOutputAmount, '0');

      res = await this.indiciesZap.depositEth(pool.address, { value: aliceEthToSwap, from: alice });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'Deposit', {
        roundKey: secondRoundEthKey,
        pool: pool.address,
        user: alice,
        inputToken: ETH,
        inputAmount: aliceEthToSwap
      });

      assert.equal(await this.indiciesZap.getRoundUserOutput(firstRoundEthKey, alice), '0');
      assert.equal(await this.indiciesZap.getRoundUserOutput(firstRoundEthKey, bob), '0');

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.totalOutputAmountClaimed, '0');

      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [alice, bob], '0x', {from: dan}), 'NOT_HDH');
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [alice, bob], '0x', {from: slasher}), 'NOT_HDH');
      await expectRevert(this.indiciesZap.claimPokeFromReporter('2', firstRoundEthKey, [alice, bob], '0x', {from: reporter}), 'NOT_HDH');

      await this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [alice, bob], '0x', {from: reporter});
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [alice], '0x', {from: reporter}), 'OUTPUT_NOT_NULL');
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [bob], '0x', {from: reporter}), 'OUTPUT_NOT_NULL');
      assertEqualWithAccuracy(await pool.balanceOf(alice), divBN(mulBN(poolOutForEth, aliceEthToSwap), totalEthToSwap), ether('0.05'));
      assertEqualWithAccuracy(await pool.balanceOf(bob), divBN(mulBN(poolOutForEth, bobEthToSwap), totalEthToSwap), ether('0.05'));

      assertEqualWithAccuracy(await this.indiciesZap.getRoundUserOutput(firstRoundEthKey, alice), await pool.balanceOf(alice), ether('0.0000001'));
      assertEqualWithAccuracy(await this.indiciesZap.getRoundUserOutput(firstRoundEthKey, bob), await pool.balanceOf(bob), ether('0.0000001'));

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assertEqualWithAccuracy(round.totalOutputAmount, poolOutForEth, ether('0.05'));
      assertEqualWithAccuracy(round.totalOutputAmount, round.totalOutputAmountClaimed, ether('0.0000001'));
      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalOutputAmount, '0');

      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [dan, carol], '0x', {from: reporter}), 'INPUT_NULL');
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundUsdcKey, [dan, carol], '0x', {from: reporter}), 'NULL_TO');

      const { erc20AfterFee: usdcInAfterFee } = await erc20PiptSwap.calcErc20Fee(usdc.address, totalUsdcToSwap);
      const {poolOut: poolOutForUsdc} = await erc20PiptSwap.calcSwapErc20ToPiptInputs(
        usdc.address,
        usdcInAfterFee,
        balancerTokens.map(t => t.address),
        await erc20PiptSwap.defaultSlippage(),
        true
      );

      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromSlasher('2', [firstRoundEthKey], '0x', {from: dan}), 'INVALID_POKER_KEY');
      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromSlasher('2', [firstRoundEthKey], '0x', {from: reporter}), 'INVALID_POKER_KEY');
      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromSlasher('1', [firstRoundEthKey], '0x', {from: slasher}), 'INVALID_POKER_KEY');

      res = await this.indiciesZap.supplyAndRedeemPokeFromSlasher('2', [firstRoundUsdcKey], '0x', {from: slasher});

      const thirdRoundUsdcKey = await this.indiciesZap.getRoundKey(res.receipt.blockNumber, pool.address, usdc.address, pool.address);
      endTime = await web3.eth.getBlock(res.receipt.blockNumber).then(b => (b.timestamp + roundPeriod).toString());
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound', {
        endTime,
        key: thirdRoundUsdcKey,
        pool: pool.address,
        inputToken: usdc.address,
        outputToken: pool.address
      });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound', {
        key: secondRoundUsdcKey,
        pool: pool.address,
        inputToken: usdc.address,
        totalInputAmount: danUsdcToSwap,
        inputCap: usdcTokenCap
      });

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assertEqualWithAccuracy(round.totalOutputAmount, poolOutForUsdc, ether('0.05'));

      round = await this.indiciesZap.rounds(secondRoundUsdcKey);
      assert.equal(round.endTime, await web3.eth.getBlock(res.receipt.blockNumber).then(b => b.timestamp.toString()));

      await expectRevert(this.indiciesZap.claimPokeFromSlasher('2', firstRoundEthKey, [alice, bob], '0x', {from: dan}), 'INVALID_POKER_KEY');
      await expectRevert(this.indiciesZap.claimPokeFromSlasher('2', firstRoundEthKey, [alice, bob], '0x', {from: reporter}), 'INVALID_POKER_KEY');
      await expectRevert(this.indiciesZap.claimPokeFromSlasher('1', firstRoundEthKey, [alice, bob], '0x', {from: slasher}), 'INVALID_POKER_KEY');

      res = await this.indiciesZap.claimPokeFromSlasher('2', firstRoundUsdcKey, [dan, carol], '0x', {from: slasher});
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'ClaimPoke', {
        roundKey: firstRoundUsdcKey,
        pool: pool.address,
        claimFor: dan,
        inputToken: usdc.address,
        outputToken: pool.address,
        inputAmount: await this.indiciesZap.getRoundUserInput(firstRoundUsdcKey, dan),
        outputAmount: await this.indiciesZap.getRoundUserOutput(firstRoundUsdcKey, dan)
      });

      assertEqualWithAccuracy(await pool.balanceOf(dan), divBN(mulBN(poolOutForUsdc, danUsdcToSwap), totalUsdcToSwap), ether('0.05'));
      assertEqualWithAccuracy(await pool.balanceOf(carol), divBN(mulBN(poolOutForUsdc, carolUsdcToSwap), totalUsdcToSwap), ether('0.05'));

      assertEqualWithAccuracy(await this.indiciesZap.getRoundUserOutput(firstRoundUsdcKey, dan), await pool.balanceOf(dan), ether('0.0000001'));
      assertEqualWithAccuracy(await this.indiciesZap.getRoundUserOutput(firstRoundUsdcKey, carol), await pool.balanceOf(carol), ether('0.0000001'));

      const alicePoolBalance = await pool.balanceOf(alice);
      await expectRevert(this.indiciesZap.depositPoolToken(pool.address, usdc.address, alicePoolBalance, { from: alice }), 'ERR_BTOKEN_BAD_CALLER');
      await pool.approve(this.indiciesZap.address, alicePoolBalance, { from: alice });
      res = await this.indiciesZap.depositPoolToken(pool.address, usdc.address, alicePoolBalance, { from: alice });
      const firstRoundPoolUsdcKey = await this.indiciesZap.getLastRoundKey(pool.address, pool.address, usdc.address);
      endTime = await web3.eth.getBlock(res.receipt.blockNumber).then(b => (b.timestamp + roundPeriod).toString());
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound');
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound', {
        endTime,
        key: firstRoundPoolUsdcKey,
        pool: pool.address,
        inputToken: pool.address,
        outputToken: usdc.address
      });

      round = await this.indiciesZap.rounds(firstRoundPoolUsdcKey);
      assert.equal(round.totalInputAmount, alicePoolBalance);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundPoolUsdcKey, alice), alicePoolBalance);

      await expectRevert(this.indiciesZap.withdrawPoolToken(pool.address, usdc.address, mulBN(alicePoolBalance, 2), { from: alice }), 'subtraction overflow');
      await expectRevert(this.indiciesZap.withdrawPoolToken(pool.address, usdc.address, alicePoolBalance, { from: bob }), 'subtraction overflow');
      await expectRevert(this.indiciesZap.withdrawPoolToken(pool.address, usdc.address, subBN(alicePoolBalance, '1'), { from: alice }), 'MIN_INPUT');

      res = await this.indiciesZap.withdrawPoolToken(pool.address, usdc.address, alicePoolBalance, { from: alice });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'Withdraw', {
        roundKey: firstRoundPoolUsdcKey,
        pool: pool.address,
        user: alice,
        inputToken: pool.address,
        inputAmount: alicePoolBalance
      });

      round = await this.indiciesZap.rounds(firstRoundPoolUsdcKey);
      assert.equal(round.totalInputAmount, '0');
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundPoolUsdcKey, alice), '0');

      await pool.approve(this.indiciesZap.address, alicePoolBalance, { from: alice });
      res = await this.indiciesZap.depositPoolToken(pool.address, usdc.address, alicePoolBalance, { from: alice });
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound');
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound');

      round = await this.indiciesZap.rounds(firstRoundPoolUsdcKey);
      assert.equal(round.totalInputAmount, alicePoolBalance);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundPoolUsdcKey, alice), alicePoolBalance);

      const bobPoolBalance = await pool.balanceOf(bob);
      await pool.approve(this.indiciesZap.address, bobPoolBalance, { from: bob });
      res = await this.indiciesZap.depositPoolToken(pool.address, usdc.address, bobPoolBalance, { from: bob });
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound');
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound');

      assert.equal(await usdc.balanceOf(alice), '0');
      assert.equal(await usdc.balanceOf(bob), '0');

      const totalPoolUsdcRoundInput = addBN(alicePoolBalance, bobPoolBalance);
      round = await this.indiciesZap.rounds(firstRoundPoolUsdcKey);
      assert.equal(round.totalInputAmount, totalPoolUsdcRoundInput);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundPoolUsdcKey, alice), alicePoolBalance);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundPoolUsdcKey, bob), bobPoolBalance);

      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [firstRoundPoolUsdcKey], '0x', {from: reporter}), 'CUR_ROUND');

      await time.increase(roundPeriod);

      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromSlasher('2', [firstRoundPoolUsdcKey], '0x', {from: slasher}), 'MAX_I');

      res = await this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [firstRoundPoolUsdcKey], '0x', {from: reporter});
      const secondRoundPoolUsdcKey = await this.indiciesZap.getRoundKey(res.receipt.blockNumber, pool.address, pool.address, usdc.address);
      endTime = await web3.eth.getBlock(res.receipt.blockNumber).then(b => (b.timestamp + roundPeriod).toString());
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRound', {
        endTime,
        key: secondRoundPoolUsdcKey,
        pool: pool.address,
        inputToken: pool.address,
        outputToken: usdc.address
      });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'FinishRound', {
        key: firstRoundPoolUsdcKey,
        pool: pool.address,
        inputToken: pool.address,
        totalInputAmount: totalPoolUsdcRoundInput,
        inputCap: '0'
      });

      const {totalErc20Out} = await erc20PiptSwap.calcSwapPiptToErc20Inputs(
        usdc.address,
        totalPoolUsdcRoundInput,
        await erc20PiptSwap.getPiptTokens(),
        true,
      );

      round = await this.indiciesZap.rounds(firstRoundPoolUsdcKey);
      assertEqualWithAccuracy(round.totalOutputAmount, totalErc20Out, ether('0.05'));

      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundUsdcKey, [alice, bob, dan], '0x', {from: reporter}), 'INPUT_NULL');
      await this.indiciesZap.claimPokeFromReporter('1', firstRoundPoolUsdcKey, [alice, bob], '0x', {from: reporter});
      assertEqualWithAccuracy(await usdc.balanceOf(alice), divBN(mulBN(totalErc20Out, alicePoolBalance), totalPoolUsdcRoundInput), ether('0.05'));
      assertEqualWithAccuracy(await usdc.balanceOf(bob), divBN(mulBN(totalErc20Out, bobPoolBalance), totalPoolUsdcRoundInput), ether('0.05'));
    });
  });

  describe('Supply and Redeem of VAULT pool', () => {
    let usdc, tokens, vaults, bPoolBalances, pool, vaultRegistry;

    beforeEach(async () => {
      tokens = [];
      vaults = [];
      bPoolBalances = [];
      const vaultsData = JSON.parse(fs.readFileSync('data/vaultsData.json', { encoding: 'utf8' }));

      usdc = await MockERC20.new('USDC', 'USDC', '6', mwei('50000000'));

      vaultRegistry = await MockCurvePoolRegistry.new();
      for (let i = 0; i < vaultsData.length; i++) {
        const v = vaultsData[i];
        const lpToken = await MockERC20.new('', '', '18', v.totalSupply);
        const vault = await MockVault.new(lpToken.address, v.usdtValue, v.totalSupply);
        let depositor;
        if (v.config.amountsLength === 2) {
          depositor = await MockCurveDepositor2.new(lpToken.address, usdc.address, v.config.usdcIndex, v.usdcToLpRate);
        } else if (v.config.amountsLength === 3) {
          depositor = await MockCurveDepositor3.new(lpToken.address, usdc.address, v.config.usdcIndex, v.usdcToLpRate);
        } else if (v.config.amountsLength === 4) {
          depositor = await MockCurveDepositor4.new(lpToken.address, usdc.address, v.config.usdcIndex, v.usdcToLpRate);
        }
        await lpToken.transfer(depositor.address, v.totalSupply);
        await vaultRegistry.set_virtual_price(lpToken.address, v.usdcToLpRate);

        vaults.push({
          lpToken,
          vault,
          depositor,
          config: v.config,
        })
        tokens.push(vault);
        bPoolBalances.push(poolsData[i].balancerBalance);
      }

      pool = await this.makePowerIndexPool(tokens, bPoolBalances);

      this.indiciesZap = await deployProxied(
        IndicesSupplyRedeemZap,
        [usdc.address, this.poke.address],
        [roundPeriod],
        {proxyAdminOwner: minter}
      );

      ETH = await this.indiciesZap.ETH();
      await time.increase(12 * 60 * 60);
    });

    it('should deposit, withdraw, supply, redeem and claim correctly', async () => {
      const vaultPoolSwap = await Erc20VaultPoolSwap.new(usdc.address, {
        from: minter,
      });
      await vaultPoolSwap.setVaultConfigs(
        vaults.map(v => v.vault.address),
        vaults.map(v => v.depositor.address),
        vaults.map(v => v.config.depositorType || 1),
        vaults.map(v => v.config.amountsLength),
        vaults.map(v => v.config.usdcIndex),
        vaults.map(v => v.lpToken.address),
        vaults.map(() => vaultRegistry.address),
      );
      await vaultPoolSwap.updatePools([pool.address]);

      await this.indiciesZap.setPools([pool.address], ['2'], {from: minter});
      await this.indiciesZap.setPoolsSwapContracts([pool.address], [vaultPoolSwap.address], {from: minter});

      await usdc.transfer(dan, mwei('1000'), {from: minter});
      await usdc.approve(this.indiciesZap.address, mwei('1000'), {from: dan});
      await usdc.transfer(carol, mwei('2000'), {from: minter});
      await usdc.approve(this.indiciesZap.address, mwei('2000'), {from: carol});

      let res = await this.indiciesZap.depositErc20(pool.address, usdc.address, mwei('1000'), { from: dan });

      const firstRoundEthKey = await this.indiciesZap.getRoundKey(res.receipt.blockNumber, pool.address, ETH, pool.address);
      const firstRoundUsdcKey = await this.indiciesZap.getRoundKey(res.receipt.blockNumber, pool.address, usdc.address, pool.address);
      assert.notEqual(firstRoundEthKey, firstRoundUsdcKey);

      await this.indiciesZap.depositErc20(pool.address, usdc.address, mwei('2000'), { from: carol });

      let round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, mwei('3000'));

      await this.indiciesZap.withdrawErc20(pool.address, usdc.address, mwei('1500'), { from: carol });

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, mwei('1500'));

      await time.increase(roundPeriod);

      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [alice, bob], '0x', {from: reporter}), 'NULL_TO');
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundUsdcKey, [dan, carol], '0x', {from: reporter}), 'NULL_TO');

      await this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [firstRoundUsdcKey], '0x', {from: reporter});
      assert.equal(await pool.balanceOf(alice), '0');
      assert.equal(await pool.balanceOf(bob), '0');

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalOutputAmount, ether('0.152800516149818229'));
      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.totalOutputAmount, '0');

      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundUsdcKey, [alice, bob], '0x', {from: reporter}), 'INPUT_NULL');
      await this.indiciesZap.claimPokeFromReporter('1', firstRoundUsdcKey, [dan, carol], '0x', {from: reporter});
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundUsdcKey, [dan, carol], '0x', {from: reporter}), 'OUTPUT_NOT_NULL');
      assert.equal(await pool.balanceOf(dan), ether('0.101867010766545484'));
      assert.equal(await pool.balanceOf(carol), ether('0.050933505383272741'));

      assert.equal(await this.indiciesZap.getRoundUserOutput(firstRoundUsdcKey, dan), ether('0.101867010766545485'));
      assert.equal(await this.indiciesZap.getRoundUserOutput(firstRoundUsdcKey, carol), ether('0.050933505383272742'));

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalOutputAmount, ether('0.152800516149818229'));
      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.totalOutputAmount, '0');

      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundUsdcKey, [alice, bob], '0x', {from: reporter}), 'INPUT_NULL');
      await expectRevert(this.indiciesZap.claimPokeFromReporter('1', firstRoundEthKey, [alice, bob], '0x', {from: reporter}), 'NULL_TO');

      await expectRevert(this.indiciesZap.supplyAndRedeemPokeFromReporter('1', [firstRoundUsdcKey], '0x', {from: reporter}), 'TO_NOT_NULL');
    });
  });
});
