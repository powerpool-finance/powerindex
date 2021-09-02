const fs = require('fs');
const {buildBasicRouterConfig, buildBasicRouterArgs} = require('./helpers/builders');

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
const EthPiptSwap = artifacts.require('EthPiptSwap');
const Erc20PiptSwap = artifacts.require('Erc20PiptSwap');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockBPoolClient = artifacts.require('MockBPoolClient');
const PowerIndexWrapper = artifacts.require('PowerIndexWrapper');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const WrappedPiErc20Factory = artifacts.require('WrappedPiErc20Factory');
const BasicPowerIndexRouterFactory = artifacts.require('MockBasicPowerIndexRouterFactory');
const PowerIndexBasicRouter = artifacts.require('MockPowerIndexBasicRouter');
const ProxyFactory = artifacts.require('ProxyFactory');

WETH.numberFormat = 'String';
MockERC20.numberFormat = 'String';
UniswapV2Pair.numberFormat = 'String';
UniswapV2Router02.numberFormat = 'String';
EthPiptSwap.numberFormat = 'String';
Erc20PiptSwap.numberFormat = 'String';
PowerIndexPool.numberFormat = 'String';
PowerIndexWrapper.numberFormat = 'String';

const { web3 } = PowerIndexPoolFactory;

const { ether, getTimestamp, subBN, addBN, assertEqualWithAccuracy, isBNHigher } = require('./helpers');

describe('EthPiptSwap and Erc20PiptSwap', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const swapFee = ether('0.0001');
  const communitySwapFee = ether('0.001');
  const communityJoinFee = ether('0.001');
  const communityExitFee = ether('0.001');

  const poolsData = JSON.parse(fs.readFileSync('data/poolsData.json', { encoding: 'utf8' }));

  const gasPrice = 100 * 10**9;

  let minter, bob, feeManager, feeReceiver, permanentVotingPower;
  before(async function () {
    [minter, bob, feeManager, feeReceiver, permanentVotingPower] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();
    await this.weth.deposit({ value: ether('50000000') });

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
      const pool = await PowerIndexPool.at(logNewPool.args.pool);
      await pool.setRestrictions(this.poolRestrictions.address, { from: minter });

      return pool;
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

  describe('Swaps with Uniswap mainnet values', () => {
    let cvp, cvpPair, tokens, balancerTokens, pairs, bPoolBalances, pool;

    const tokenBySymbol = {};

    beforeEach(async () => {
      tokens = [];
      balancerTokens = [];
      pairs = [];
      bPoolBalances = [];

      for (let i = 0; i < poolsData.length; i++) {
        const token = await MockERC20.new(poolsData[i].tokenSymbol, poolsData[i].tokenSymbol, poolsData[i].tokenDecimals, ether('10000000000'));

        const uniPair = poolsData[i].uniswapPair;
        const pair = await this.makeUniswapPair(token, uniPair.tokenReserve, uniPair.ethReserve, uniPair.isReverse);
        tokens.push(token);
        pairs.push(pair);
        bPoolBalances.push(poolsData[i].balancerBalance);
        if (poolsData[i].tokenSymbol === 'CVP') {
          cvp = token;
          cvpPair = pair;
        }

        tokenBySymbol[poolsData[i].tokenSymbol] = { token, pair };
      }

      balancerTokens =  tokens.filter((t, i) => poolsData[i].balancerBalance !== '0');

      pool = await this.makePowerIndexPool(balancerTokens, bPoolBalances.filter(b => b !== '0'));

      await time.increase(12 * 60 * 60);
    });

    it('diff percent check should work properly', async () => {
      const ethPiptSwap = await EthPiptSwap.new(this.weth.address, cvp.address, pool.address, zeroAddress, feeManager, {
        from: minter,
      });

      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('20000').toString(10)], {from: minter});

      await ethPiptSwap.setTokensSettings(
        tokens.map(t => t.address),
        pairs.map(p => p.address),
        pairs.map(() => true),
        {from: minter},
      );

      const ethToSwap = ether('600').toString(10);
      const slippage = ether('0.05');
      const maxDiff = ether('0.02');

      const {ethAfterFee: ethInAfterFee} = await ethPiptSwap.calcEthFee(ethToSwap);

      await this.uniswapRouter.swapExactETHForTokens('0', [this.weth.address, tokens[0].address], minter, new Date().getTime(), {
        from: minter,
        value: ether(1000)
      })

      const swapEthToPiptInputs = await ethPiptSwap.calcSwapEthToPiptInputs(
        ethInAfterFee,
        balancerTokens.map(t => t.address),
        slippage,
      );
      const needEthToPoolOut = await ethPiptSwap.calcNeedEthToPoolOut(swapEthToPiptInputs.poolOut, slippage);
      assertEqualWithAccuracy(needEthToPoolOut, ethToSwap, ether('0.05'))
      assert.equal(isBNHigher(needEthToPoolOut, ethToSwap), true)

      await expectRevert(
        ethPiptSwap.swapEthToPipt(slippage, '0', maxDiff, {
          from: bob,
          value: ethToSwap,
          gasPrice
        }),
        'MAX_DIFF_PERCENT',
      );
    });

    it('swapEthToPipt should work properly', async () => {
      const ethPiptSwap = await EthPiptSwap.new(this.weth.address, cvp.address, pool.address, zeroAddress, feeManager, {
        from: minter,
      });

      await expectRevert(ethPiptSwap.setFees([ether('1')], [ether('0.1')], bob, bob, { from: bob }), 'NOT_FEE_MANAGER');

      await ethPiptSwap.setFees([ether('1')], [ether('0.1')], feeReceiver, feeManager, { from: minter });
      await ethPiptSwap.setFees([ether('100'), ether('1')], [ether('0.01'), ether('0.005')], feeReceiver, feeManager, {
        from: feeManager,
      });

      await expectRevert(
        ethPiptSwap.setTokensSettings(
          tokens.map(t => t.address),
          pairs.map(p => p.address),
          pairs.map(() => true),
          { from: bob },
        ),
        'Ownable: caller is not the owner',
      );

      await ethPiptSwap.setTokensSettings(
        tokens.map(t => t.address),
        pairs.map(p => p.address),
        pairs.map(() => true),
        { from: minter },
      );

      const { ethFee: ethFee2, ethAfterFee: ethAfterFee2 } = await ethPiptSwap.calcEthFee(ether('1'));
      assert.equal(ethFee2, ether('0.005').toString(10));
      assert.equal(ethAfterFee2, ether('0.995').toString(10));

      const { ethFee: ethFee3, ethAfterFee: ethAfterFee3 } = await ethPiptSwap.calcEthFee(ether('0.1'));
      assert.equal(ethFee3, '0');
      assert.equal(ethAfterFee3, ether('0.1').toString(10));

      const ethToSwap = ether('600').toString(10);
      const slippage = ether('0.05');
      const maxDiff = ether('0.02');

      const { ethFee: ethInFee, ethAfterFee: ethInAfterFee } = await ethPiptSwap.calcEthFee(ethToSwap);
      // assert.equal(ethFee, ether('0.2').toString(10));
      // assert.equal(ethAfterFee, ether('9.8').toString(10));

      const swapEthToPiptInputs = await ethPiptSwap.calcSwapEthToPiptInputs(
        ethInAfterFee,
        balancerTokens.map(t => t.address),
        slippage,
      );
      const needEthToPoolOut = await ethPiptSwap.calcNeedEthToPoolOut(swapEthToPiptInputs.poolOut, slippage);
      assertEqualWithAccuracy(needEthToPoolOut, ethToSwap, ether('0.05'))
      assert.equal(isBNHigher(needEthToPoolOut, ethToSwap), true)

      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('10').toString(10)], { from: minter });

      await expectRevert(
        ethPiptSwap.swapEthToPipt(slippage, '0', maxDiff, { from: bob, value: ethToSwap, gasPrice }),
        'PIPT_MAX_SUPPLY',
      );

      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('20000').toString(10)], { from: minter });

      const {
        tokenAmountInAfterFee: poolOutAfterFee,
        tokenAmountFee: poolOutFee,
      } = await pool.calcAmountWithCommunityFee(swapEthToPiptInputs.poolOut, communityJoinFee, ethPiptSwap.address);

      await expectRevert(
        ethPiptSwap.swapEthToPipt(slippage, addBN(swapEthToPiptInputs.poolOut, '1'), maxDiff, { from: bob, value: ethToSwap, gasPrice }),
        'MIN_POOL_AMOUNT_OUT',
      );
      let bobBalanceBefore = await web3.eth.getBalance(bob);

      let res = await ethPiptSwap.swapEthToPipt(slippage, swapEthToPiptInputs.poolOut, maxDiff, { from: bob, value: ethToSwap, gasPrice });

      let weiUsed = res.receipt.gasUsed * gasPrice;
      console.log('        swapEthToPipt gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));
      let balanceAfterWeiUsed = subBN(bobBalanceBefore, weiUsed);
      const oddEth = res.receipt.logs.filter(l => l.event === 'OddEth')[0].args;
      assert.equal(subBN(addBN(balanceAfterWeiUsed, oddEth.amount), ethToSwap), await web3.eth.getBalance(bob));
      assert.equal(await this.weth.balanceOf(ethPiptSwap.address), ethInFee);

      const swap = res.receipt.logs.filter(l => l.event === 'EthToPiptSwap')[0].args;
      assert.equal(swap.ethSwapFee, ethInFee);
      assert.equal(swap.ethInAmount, ethInAfterFee);
      assert.equal(swap.poolOutAmount, swapEthToPiptInputs.poolOut);
      assert.equal(swap.poolCommunityFee, poolOutFee);

      assert.equal(poolOutAfterFee, await pool.balanceOf(bob));

      let cvpOutForReceiver = await this.getPairAmountOut(cvpPair, ethInFee);

      assert.equal(await cvp.balanceOf(feeReceiver), '0');

      // TODO: check msg.sender == tx.origin
      res = await ethPiptSwap.convertOddToCvpAndSendToPayout([], { from: bob });
      let feeReceiverBalanceSwapIn = await cvp.balanceOf(feeReceiver);
      assert.equal(feeReceiverBalanceSwapIn, cvpOutForReceiver);
      assert.equal(await this.weth.balanceOf(ethPiptSwap.address), '0');

      const payoutCVP = res.receipt.logs.filter(l => l.event === 'PayoutCVP')[0].args;
      assert.equal(payoutCVP.wethAmount, ethInFee);

      for (let i = 0; i < balancerTokens.length; i++) {
        assert.notEqual(await balancerTokens[i].balanceOf(ethPiptSwap.address), '0');
      }
      await ethPiptSwap.convertOddToCvpAndSendToPayout(
        balancerTokens.map(t => t.address),
        { from: bob },
      );
      for (let i = 0; i < balancerTokens.length; i++) {
        assert.equal(await balancerTokens[i].balanceOf(ethPiptSwap.address), '0');
      }
      feeReceiverBalanceSwapIn = await cvp.balanceOf(feeReceiver);
      assert.notEqual(feeReceiverBalanceSwapIn, cvpOutForReceiver);

      const swapPiptToEthInputs = await ethPiptSwap.calcSwapPiptToEthInputs(
        poolOutAfterFee,
        balancerTokens.map(t => t.address),
      );

      const { ethFee: ethOutFee, ethAfterFee: ethOutAfterFee } = await ethPiptSwap.calcEthFee(
        swapPiptToEthInputs.totalEthOut,
      );

      await pool.approve(ethPiptSwap.address, poolOutAfterFee, { from: bob });

      bobBalanceBefore = await web3.eth.getBalance(bob);
      res = await ethPiptSwap.swapPiptToEth(poolOutAfterFee, { from: bob, gasPrice });

      weiUsed = res.receipt.gasUsed * gasPrice;
      console.log('        swapPiptToEth gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));
      balanceAfterWeiUsed = subBN(bobBalanceBefore, weiUsed);

      assert.equal(addBN(balanceAfterWeiUsed, ethOutAfterFee), await web3.eth.getBalance(bob));
      assert.equal(await this.weth.balanceOf(ethPiptSwap.address), ethOutFee);

      cvpOutForReceiver = await this.getPairAmountOut(cvpPair, ethOutFee);

      await ethPiptSwap.convertOddToCvpAndSendToPayout([], { from: bob });
      assert.equal(await this.weth.balanceOf(ethPiptSwap.address), '0');

      const feeReceiverBalanceSwapOut = await cvp.balanceOf(feeReceiver);
      assert.equal(addBN(feeReceiverBalanceSwapIn, cvpOutForReceiver), feeReceiverBalanceSwapOut);
    });

    describe('swapErc20ToPipt should work properly', async () => {
      let erc20PiptSwap;

      beforeEach(async () => {
        await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('200').toString(10)], { from: minter });

        erc20PiptSwap = await Erc20PiptSwap.new(this.weth.address, cvp.address, pool.address, zeroAddress, feeManager, {
          from: minter,
        });

        await erc20PiptSwap.setFees([ether('100'), ether('1')], [ether('0.01'), ether('0.005')], feeReceiver, feeManager, {
          from: feeManager,
        });

        await expectRevert(erc20PiptSwap.fetchUnswapPairsFromFactory(
          this.uniswapFactory.address,
          tokens.map(t => t.address),
          { from: bob },
        ), 'Ownable: caller is not the owner');

        await erc20PiptSwap.fetchUnswapPairsFromFactory(
          this.uniswapFactory.address,
          tokens.map(t => t.address),
          { from: minter },
        );
      });


      ['USDC', 'USDT'].forEach(erc20TokenSymbol => {
        const {token: usdToken, pair: usdPair} = tokenBySymbol[erc20TokenSymbol];
        const tokenAddress = usdToken.address;
        const amountToSwap = (100 * 10 ** 6).toString(10);
        const slippage = ether('0.02');
        const maxDiffPercent = ether('0.02');

        it('diff percent check should work properly', async () => {
          await usdToken.approve(erc20PiptSwap.address, amountToSwap, {from: bob});

          await this.uniswapRouter.swapExactETHForTokens('0', [this.weth.address, tokens[0].address], minter, new Date().getTime(), {
            from: minter,
            value: ether(1000)
          });

          await expectRevert(
            erc20PiptSwap.swapErc20ToPipt(tokenAddress, amountToSwap, slippage, '0', maxDiffPercent, {from: bob, gasPrice}),
            'MAX_DIFF_PERCENT'
          );
        });

        it(`${erc20TokenSymbol} swapErc20ToPipt`, async () => {
          await usdToken.transfer(bob, amountToSwap);

          const {
            erc20Fee: erc20InFee,
            erc20AfterFee: erc20InAfterFee,
            ethFee,
            ethAfterFee
          } = await erc20PiptSwap.calcErc20Fee(tokenAddress, amountToSwap);

          const token0 = await usdPair.token0();
          const {_reserve0, _reserve1} = await usdPair.getReserves();
          const ethReserve = token0.toLowerCase() === this.weth.address.toLowerCase() ? _reserve0 : _reserve1;
          const tokenReserve = token0.toLowerCase() === this.weth.address.toLowerCase() ? _reserve1 : _reserve0;
          const erc20FeeToEthConverted = ethFee !== '0' ? await this.uniswapRouter.getAmountOut(ethFee, ethReserve, tokenReserve) : ethFee;
          const erc20AfterFeeToEthConverted = await this.uniswapRouter.getAmountOut(ethAfterFee, ethReserve, tokenReserve);
          assert.equal(erc20InFee, erc20FeeToEthConverted);
          assert.equal(erc20InAfterFee, erc20AfterFeeToEthConverted);

          const swapErc20ToPiptInputs = await erc20PiptSwap.calcSwapErc20ToPiptInputs(
            tokenAddress,
            amountToSwap,
            balancerTokens.map(t => t.address),
            slippage,
            true,
          );
          const needErc20ToPoolOut = await erc20PiptSwap.calcNeedErc20ToPoolOut(tokenAddress, swapErc20ToPiptInputs.poolOut, slippage);
          assertEqualWithAccuracy(needErc20ToPoolOut, amountToSwap, ether('0.02'));
          assert.equal(isBNHigher(needErc20ToPoolOut, amountToSwap), true);

          let bobBalanceBefore = await usdToken.balanceOf(bob);

          const {
            tokenAmountInAfterFee: poolOutAfterFee,
            tokenAmountFee: poolOutFee,
          } = await pool.calcAmountWithCommunityFee(swapErc20ToPiptInputs.poolOut, communityJoinFee, erc20PiptSwap.address);

          await usdToken.approve(erc20PiptSwap.address, amountToSwap, {from: bob});

          await expectRevert(erc20PiptSwap.swapErc20ToPipt(tokenAddress, amountToSwap, slippage, addBN(swapErc20ToPiptInputs.poolOut, '1'), maxDiffPercent, {from: bob, gasPrice}), 'MIN_POOL_AMOUNT_OUT')

          let res = await erc20PiptSwap.swapErc20ToPipt(tokenAddress, amountToSwap, slippage, swapErc20ToPiptInputs.poolOut, maxDiffPercent, {from: bob, gasPrice});
          let weiUsed = res.receipt.gasUsed * gasPrice;
          console.log('          swapErc20ToPipt gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));

          assert.equal(subBN(bobBalanceBefore, amountToSwap), await usdToken.balanceOf(bob));
          assert.equal(await this.weth.balanceOf(erc20PiptSwap.address), ethFee);

          const swap = res.receipt.logs.filter(l => l.event === 'EthToPiptSwap')[0].args;
          assert.equal(swap.ethSwapFee, ethFee);
          assert.equal(swap.ethInAmount, ethAfterFee);
          assert.equal(swap.poolOutAmount, swapErc20ToPiptInputs.poolOut);
          assert.equal(swap.poolCommunityFee, poolOutFee);

          const erc20Swap = res.receipt.logs.filter(l => l.event === 'Erc20ToPiptSwap')[0].args;
          assert.equal(erc20Swap.erc20InAmount, amountToSwap);
          assert.equal(erc20Swap.ethInAmount, addBN(ethFee, ethAfterFee));
          assertEqualWithAccuracy(erc20Swap.poolOutAmount, swapErc20ToPiptInputs.poolOut, ether('0.002'));

          assert.equal(poolOutAfterFee, await pool.balanceOf(bob));

          const swapPiptToEthInputs = await erc20PiptSwap.calcSwapPiptToErc20Inputs(
            tokenAddress,
            poolOutAfterFee,
            balancerTokens.map(t => t.address),
            true,
          );

          await pool.approve(erc20PiptSwap.address, poolOutAfterFee, {from: bob});

          bobBalanceBefore = await usdToken.balanceOf(bob);
          res = await erc20PiptSwap.swapPiptToErc20(tokenAddress, poolOutAfterFee, {from: bob, gasPrice});
          weiUsed = res.receipt.gasUsed * gasPrice;
          console.log('          swapErc20ToPipt gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));

          assert.equal(addBN(bobBalanceBefore, swapPiptToEthInputs.totalErc20Out), await usdToken.balanceOf(bob));
          assert.equal(await pool.balanceOf(bob), '0');
        });
      });
    });

    it('PowerIndexPool should prevent double swap in same transaction by EthPiptSwap', async () => {
      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('200').toString(10)], { from: minter });

      const ethPiptSwap = await EthPiptSwap.new(this.weth.address, cvp.address, pool.address, zeroAddress, feeManager, {
        from: minter,
      });

      await ethPiptSwap.fetchUnswapPairsFromFactory(
        this.uniswapFactory.address,
        tokens.map(t => t.address),
        { from: minter },
      )

      const mockClient = await MockBPoolClient.new();
      await expectRevert(
        mockClient.callBPoolTwice(ethPiptSwap.address, { from: minter, value: ether('1') }),
        'SAME_TX_ORIGIN',
      );
    })

    describe('swapErc20ToPipt with piToken and ethFee should work properly', async () => {
      let erc20PiptSwap, piTokenTotalEthFee;
      const piTokenEthFee = ether(0.0001).toString();

      beforeEach(async () => {
        const defaultFactoryArguments = buildBasicRouterArgs(web3, buildBasicRouterConfig(
          this.poolRestrictions.address,
          constants.ZERO_ADDRESS,
          constants.ZERO_ADDRESS,
          constants.ZERO_ADDRESS,
          ether(0),
          '0',
          '0',
          feeReceiver,
          ether(0),
          []
        ));
        const poolWrapper = await PowerIndexWrapper.new(pool.address);

        erc20PiptSwap = await Erc20PiptSwap.new(
          this.weth.address,
          balancerTokens[1].address,
          pool.address,
          poolWrapper.address,
          feeManager,
          {from: minter}
        );

        await erc20PiptSwap.fetchUnswapPairsFromFactory(
          this.uniswapFactory.address,
          tokens.map(t => t.address),
          {from: minter},
        );

        const piTokenFactory = await WrappedPiErc20Factory.new();
        const routerFactory = await BasicPowerIndexRouterFactory.new();
        const poolController = await PowerIndexPoolController.new(pool.address, poolWrapper.address, piTokenFactory.address, zeroAddress);

        await pool.setWrapper(poolWrapper.address, true);

        await poolWrapper.setController(poolController.address);
        await pool.setController(poolController.address);

        let res = await poolController.createPiToken(balancerTokens[0].address, routerFactory.address, defaultFactoryArguments, 'W T 1', 'WT1');
        let CreatePiToken = res.receipt.logs.filter(l => l.event === 'CreatePiToken')[0].args;
        const router1 = await PowerIndexBasicRouter.at(CreatePiToken.router);
        await router1.mockSetRate(ether('0.5'));
        await router1.setPiTokenEthFee(piTokenEthFee);
        await poolController.replacePoolTokenWithExistingPiToken(balancerTokens[0].address, CreatePiToken.piToken, {
          value: piTokenEthFee
        });

        res = await poolController.createPiToken(balancerTokens[1].address, routerFactory.address, defaultFactoryArguments, 'W T 2', 'WT2');
        CreatePiToken = res.receipt.logs.filter(l => l.event === 'CreatePiToken')[0].args;
        const router2 = await PowerIndexBasicRouter.at(CreatePiToken.router);
        await router2.mockSetRate(ether('0.5'));
        await router2.setPiTokenEthFee(piTokenEthFee);
        await poolController.replacePoolTokenWithExistingPiToken(balancerTokens[1].address, CreatePiToken.piToken, {
          value: piTokenEthFee
        });

        await poolWrapper.updatePiTokenEthFees([balancerTokens[0].address, balancerTokens[1].address]);

        piTokenTotalEthFee = await poolWrapper.calcEthFeeForTokens([balancerTokens[0].address, balancerTokens[1].address]);

        await erc20PiptSwap.setFees([ether('100'), ether('1')], [ether('0.01'), ether('0.005')], feeReceiver, feeManager, {
          from: feeManager,
        });

        assert.sameMembers(balancerTokens.map(t => t.address), await erc20PiptSwap.getPiptTokens());

        await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('20000').toString(10)], {from: minter});
      });

      it('swapEthToPipt should work properly', async () => {
        const ethToSwap = ether('600').toString(10);
        const slippage = ether('0.05');
        const maxDiff = ether('0.02');

        const {ethFee: ethInFee, ethAfterFee: ethInAfterFee} = await erc20PiptSwap.calcEthFee(ethToSwap);
        assert.equal(ethInFee, ether('6.0002').toString(10));
        assert.equal(ethInAfterFee, ether('593.9998').toString(10));

        const swapEthToPiptInputs = await erc20PiptSwap.calcSwapEthToPiptInputs(
          ethInAfterFee,
          await erc20PiptSwap.getPiptTokens(),
          slippage,
        );

        const {
          tokenAmountInAfterFee: poolOutAfterFee,
          tokenAmountFee: poolOutFee,
        } = await pool.calcAmountWithCommunityFee(swapEthToPiptInputs.poolOut, communityJoinFee, erc20PiptSwap.address);

        await expectRevert(erc20PiptSwap.swapEthToPipt(slippage, addBN(swapEthToPiptInputs.poolOut, '1'), maxDiff, {from: bob, value: ethToSwap, gasPrice}), 'MIN_POOL_AMOUNT_OUT')
        let bobBalanceBefore = await web3.eth.getBalance(bob);
        let res = await erc20PiptSwap.swapEthToPipt(slippage, swapEthToPiptInputs.poolOut, maxDiff, {from: bob, value: ethToSwap, gasPrice});

        let weiUsed = res.receipt.gasUsed * gasPrice;
        console.log('          swapEthToPipt gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));
        let balanceAfterWeiUsed = subBN(bobBalanceBefore, weiUsed);
        const oddEth = res.receipt.logs.filter(l => l.event === 'OddEth')[0].args;
        assert.equal(subBN(addBN(balanceAfterWeiUsed, oddEth.amount), ethToSwap), await web3.eth.getBalance(bob));
        assert.equal(await this.weth.balanceOf(erc20PiptSwap.address), ethInFee);

        const swap = res.receipt.logs.filter(l => l.event === 'EthToPiptSwap')[0].args;
        assert.equal(swap.ethSwapFee, ethInFee);
        assert.equal(swap.ethInAmount, ethInAfterFee);
        assert.equal(swap.poolOutAmount, swapEthToPiptInputs.poolOut);
        assert.equal(swap.poolCommunityFee, poolOutFee);

        assert.equal(poolOutAfterFee, await pool.balanceOf(bob));

        const swapPiptToEthInputs = await erc20PiptSwap.calcSwapPiptToEthInputs(
          poolOutAfterFee,
          balancerTokens.map(t => t.address),
        );

        const {ethFee: ethOutFee, ethAfterFee: ethOutAfterFee} = await erc20PiptSwap.calcEthFee(
          swapPiptToEthInputs.totalEthOut,
        );

        await pool.approve(erc20PiptSwap.address, poolOutAfterFee, {from: bob});

        bobBalanceBefore = await web3.eth.getBalance(bob);
        res = await erc20PiptSwap.swapPiptToEth(poolOutAfterFee, {from: bob, value: piTokenTotalEthFee, gasPrice});

        weiUsed = res.receipt.gasUsed * gasPrice;
        console.log('          swapPiptToEth gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));
        balanceAfterWeiUsed = subBN(bobBalanceBefore, weiUsed);

        assert.equal(subBN(addBN(balanceAfterWeiUsed, ethOutAfterFee), piTokenTotalEthFee), await web3.eth.getBalance(bob));
        assert.equal(await this.weth.balanceOf(erc20PiptSwap.address), addBN(ethInFee, ethOutFee));
      });

      ['USDC', 'USDT'].forEach(erc20TokenSymbol => {
        it(`${erc20TokenSymbol} swapErc20ToPipt`, async () => {
          const {token: usdToken, pair: usdPair} = tokenBySymbol[erc20TokenSymbol];

          const tokenAddress = usdToken.address;
          const amountToSwap = (100 * 10 ** 6).toString(10);
          const slippage = ether('0.02');
          const maxDiff = ether('0.04');

          await usdToken.transfer(bob, amountToSwap);

          const {
            erc20Fee: erc20InFee,
            erc20AfterFee: erc20InAfterFee,
            ethFee,
            ethAfterFee
          } = await erc20PiptSwap.calcErc20Fee(tokenAddress, amountToSwap);

          const token0 = await usdPair.token0();
          const {_reserve0, _reserve1} = await usdPair.getReserves();
          const ethReserve = token0.toLowerCase() === this.weth.address.toLowerCase() ? _reserve0 : _reserve1;
          const tokenReserve = token0.toLowerCase() === this.weth.address.toLowerCase() ? _reserve1 : _reserve0;
          const erc20FeeToEthConverted = ethFee !== '0' ? await this.uniswapRouter.getAmountOut(ethFee, ethReserve, tokenReserve) : ethFee;
          const erc20AfterFeeToEthConverted = await this.uniswapRouter.getAmountOut(ethAfterFee, ethReserve, tokenReserve);
          assert.equal(erc20InFee, erc20FeeToEthConverted);
          assert.equal(erc20InAfterFee, erc20AfterFeeToEthConverted);

          const swapErc20ToPiptInputs = await erc20PiptSwap.calcSwapErc20ToPiptInputs(
            tokenAddress,
            amountToSwap,
            await erc20PiptSwap.getPiptTokens(),
            slippage,
            true,
          );
          const needErc20ToPoolOut = await erc20PiptSwap.calcNeedErc20ToPoolOut(tokenAddress, swapErc20ToPiptInputs.poolOut, slippage);
          assertEqualWithAccuracy(needErc20ToPoolOut, amountToSwap, ether('0.02'));
          // TODO: figure out - why needErc20ToPoolOut isn't higher then amountToSwap
          // assert.equal(isBNHigher(needErc20ToPoolOut, amountToSwap), true)

          let bobBalanceBefore = await usdToken.balanceOf(bob);

          const {
            tokenAmountInAfterFee: poolOutAfterFee,
            tokenAmountFee: poolOutFee,
          } = await pool.calcAmountWithCommunityFee(swapErc20ToPiptInputs.poolOut, communityJoinFee, erc20PiptSwap.address);

          await usdToken.approve(erc20PiptSwap.address, amountToSwap, {from: bob});

          let res = await erc20PiptSwap.swapErc20ToPipt(tokenAddress, amountToSwap, slippage, swapErc20ToPiptInputs.poolOut, maxDiff, {from: bob, gasPrice});
          let weiUsed = res.receipt.gasUsed * gasPrice;
          console.log('          swapErc20ToPipt gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));

          assert.equal(subBN(bobBalanceBefore, amountToSwap), await usdToken.balanceOf(bob));
          assert.equal(await this.weth.balanceOf(erc20PiptSwap.address), ethFee);

          const swap = res.receipt.logs.filter(l => l.event === 'EthToPiptSwap')[0].args;
          assert.equal(swap.ethSwapFee, ethFee);
          assert.equal(swap.ethInAmount, ethAfterFee);
          assert.equal(swap.poolOutAmount, swapErc20ToPiptInputs.poolOut);
          assert.equal(swap.poolCommunityFee, poolOutFee);

          const erc20Swap = res.receipt.logs.filter(l => l.event === 'Erc20ToPiptSwap')[0].args;
          assert.equal(erc20Swap.erc20InAmount, amountToSwap);
          assert.equal(erc20Swap.ethInAmount, addBN(ethFee, ethAfterFee));
          assertEqualWithAccuracy(erc20Swap.poolOutAmount, swapErc20ToPiptInputs.poolOut, ether('0.002'));

          assert.equal(poolOutAfterFee, await pool.balanceOf(bob));

          const swapPiptToEthInputs = await erc20PiptSwap.calcSwapPiptToErc20Inputs(
            tokenAddress,
            poolOutAfterFee,
            await erc20PiptSwap.getPiptTokens(),
            true,
          );

          await pool.approve(erc20PiptSwap.address, poolOutAfterFee, {from: bob});

          bobBalanceBefore = await usdToken.balanceOf(bob);
          res = await erc20PiptSwap.swapPiptToErc20(tokenAddress, poolOutAfterFee, {from: bob, gasPrice, value: piTokenTotalEthFee});
          weiUsed = res.receipt.gasUsed * gasPrice;
          console.log('          swapPiptToErc20 gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));

          assert.equal(addBN(bobBalanceBefore, swapPiptToEthInputs.totalErc20Out), await usdToken.balanceOf(bob));
          assert.equal(await pool.balanceOf(bob), '0');
        });
      });
    });
  });

  describe('Swap with 20 tokens', () => {
    let cvp, tokens, balancerTokens, pairs, bPoolBalances, pool;

    const tokenBySymbol = {};

    beforeEach(async () => {
      tokens = [];
      balancerTokens = [];
      pairs = [];
      bPoolBalances = [];

      const pools20Data = poolsData.concat(poolsData).concat(poolsData.slice(0, 4));
      for (let i = 0; i < pools20Data.length; i++) {
        const token = await MockERC20.new(pools20Data[i].tokenSymbol, pools20Data[i].tokenSymbol, pools20Data[i].tokenDecimals, ether('10000000000'));

        const uniPair = pools20Data[i].uniswapPair;
        const pair = await this.makeUniswapPair(token, uniPair.tokenReserve, uniPair.ethReserve, uniPair.isReverse);
        tokens.push(token);
        pairs.push(pair);
        bPoolBalances.push(pools20Data[i].balancerBalance);
        if (pools20Data[i].tokenSymbol === 'CVP') {
          cvp = token;
        }

        tokenBySymbol[pools20Data[i].tokenSymbol] = { token, pair };
      }

      balancerTokens = tokens.filter((t, i) => pools20Data[i].balancerBalance !== '0');

      pool = await this.makePowerIndexPool(balancerTokens, bPoolBalances.filter(b => b !== '0'));

      await time.increase(12 * 60 * 60);
    });

    it('swapEthToPipt should work properly', async () => {
      const ethPiptSwap = await EthPiptSwap.new(this.weth.address, cvp.address, pool.address, zeroAddress, feeManager, {
        from: minter,
      });

      await ethPiptSwap.setFees([ether('100'), ether('1')], [ether('0.01'), ether('0.005')], feeReceiver, feeManager, {
        from: feeManager,
      });

      await ethPiptSwap.setTokensSettings(
        tokens.map(t => t.address),
        pairs.map(p => p.address),
        pairs.map(() => true),
        {from: minter},
      );

      const ethToSwap = ether('600').toString(10);
      const slippage = ether('0.05');
      const maxDiff = ether('0.02');

      const {ethFee: ethInFee, ethAfterFee: ethInAfterFee} = await ethPiptSwap.calcEthFee(ethToSwap);

      const swapEthToPiptInputs = await ethPiptSwap.calcSwapEthToPiptInputs(
        ethInAfterFee,
        balancerTokens.map(t => t.address),
        slippage,
      );
      const needEthToPoolOut = await ethPiptSwap.calcNeedEthToPoolOut(swapEthToPiptInputs.poolOut, slippage);
      assertEqualWithAccuracy(needEthToPoolOut, ethToSwap, ether('0.05'))
      assert.equal(isBNHigher(needEthToPoolOut, ethToSwap), true)

      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('20000').toString(10)], {from: minter});

      let bobBalanceBefore = await web3.eth.getBalance(bob);

      const {
        tokenAmountInAfterFee: poolOutAfterFee,
        tokenAmountFee: poolOutFee,
      } = await pool.calcAmountWithCommunityFee(swapEthToPiptInputs.poolOut, communityJoinFee, ethPiptSwap.address);

      let res = await ethPiptSwap.swapEthToPipt(slippage, swapEthToPiptInputs.poolOut, maxDiff, {from: bob, value: ethToSwap, gasPrice});

      let weiUsed = res.receipt.gasUsed * gasPrice;
      console.log('        swapEthToPipt gasUsed', res.receipt.gasUsed, 'ethUsed(100 gwei)', web3.utils.fromWei(weiUsed.toString(), 'ether'));
      let balanceAfterWeiUsed = subBN(bobBalanceBefore, weiUsed);
      const oddEth = res.receipt.logs.filter(l => l.event === 'OddEth')[0].args;
      assert.equal(subBN(addBN(balanceAfterWeiUsed, oddEth.amount), ethToSwap), await web3.eth.getBalance(bob));
      assert.equal(await this.weth.balanceOf(ethPiptSwap.address), ethInFee);

      const swap = res.receipt.logs.filter(l => l.event === 'EthToPiptSwap')[0].args;
      assert.equal(swap.ethSwapFee, ethInFee);
      assert.equal(swap.ethInAmount, ethInAfterFee);
      assert.equal(swap.poolOutAmount, swapEthToPiptInputs.poolOut);
      assert.equal(swap.poolCommunityFee, poolOutFee);

      assert.equal(poolOutAfterFee, await pool.balanceOf(bob));
    });
  });
});
