const fs = require('fs');

const { expectRevert, ether } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const UniswapV2Factory = artifacts.require('MockUniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
const WETH = artifacts.require('MockWETH');
const EthPiptSwap = artifacts.require('EthPiptSwap');
const Erc20PiptSwap = artifacts.require('Erc20PiptSwap');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockBPoolClient = artifacts.require('MockBPoolClient');

MockERC20.numberFormat = 'String';
UniswapV2Pair.numberFormat = 'String';
UniswapV2Router02.numberFormat = 'String';
EthPiptSwap.numberFormat = 'String';
Erc20PiptSwap.numberFormat = 'String';
BPool.numberFormat = 'String';

const { web3 } = BFactory;
const { toBN } = web3.utils;

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

describe('EthPiptSwap and Erc20PiptSwap', () => {
  const swapFee = ether('0.0001');
  const communitySwapFee = ether('0.001');
  const communityJoinFee = ether('0.001');
  const communityExitFee = ether('0.001');

  const poolsData = JSON.parse(fs.readFileSync('data/poolsData.json', { encoding: 'utf8' }));

  const gasPrice = 1000000000;

  let minter, bob, feeManager, feeReceiver, permanentVotingPower;
  before(async function () {
    [minter, bob, feeManager, feeReceiver, permanentVotingPower] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();
    this.weth.deposit({ value: ether('50000000') });

    this.bFactory = await BFactory.new({ from: minter });
    this.bActions = await BActions.new({ from: minter });
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

    this.makeBalancerPool = async (_tokens, _balances) => {
      for (let i = 0; i < _tokens.length; i++) {
        await _tokens[i].approve(this.bActions.address, '0x' + 'f'.repeat(64));
      }

      const weightPart = 50 / _tokens.length;
      const res = await this.bActions.create(
        this.bFactory.address,
        'My Pool',
        'MP',
        _tokens.map(t => t.address),
        _balances,
        _tokens.map(() => ether(weightPart.toString(10))),
        [swapFee, communitySwapFee, communityJoinFee, communityExitFee],
        permanentVotingPower,
        true,
      );

      const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
      const pool = await BPool.at(logNewPool.args.pool);
      await pool.setRestrictions(this.poolRestrictions.address, { from: minter });
      return pool;
    };

    this.makeUniswapPair = async (_token, _tokenBalance, _wethBalance) => {
      const res = await this.uniswapFactory.createPairMock(_token.address, this.weth.address);
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

        const pair = await this.makeUniswapPair(
          token,
          poolsData[i].uniswapPair.tokenReserve,
          poolsData[i].uniswapPair.ethReserve,
        );
        tokens.push(token);
        pairs.push(pair);
        bPoolBalances.push(poolsData[i].balancerBalance);
        if (poolsData[i].tokenSymbol === 'CVP') {
          cvp = token;
          cvpPair = pair;
        }

        tokenBySymbol[poolsData[i].tokenSymbol] = {
          token,
          pair
        };
      }

      balancerTokens =  tokens.filter((t, i) => poolsData[i].balancerBalance !== '0');

      pool = await this.makeBalancerPool(balancerTokens, bPoolBalances.filter(b => b !== '0'));
    });

    it('swapEthToPipt should work properly', async () => {
      const ethPiptSwap = await EthPiptSwap.new(this.weth.address, cvp.address, pool.address, feeManager, {
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
      const slippage = ether('0.04');

      const { ethFee: ethInFee, ethAfterFee: ethInAfterFee } = await ethPiptSwap.calcEthFee(ethToSwap);
      // assert.equal(ethFee, ether('0.2').toString(10));
      // assert.equal(ethAfterFee, ether('9.8').toString(10));

      const swapEthToPiptInputs = await ethPiptSwap.calcSwapEthToPiptInputs(
        ethInAfterFee,
        balancerTokens.map(t => t.address),
        slippage,
      );

      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('10').toString(10)], { from: minter });

      await expectRevert(
        ethPiptSwap.swapEthToPipt(slippage, { from: bob, value: ethToSwap, gasPrice }),
        'PIPT_MAX_SUPPLY',
      );

      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('200').toString(10)], { from: minter });

      let bobBalanceBefore = await web3.eth.getBalance(bob);

      const {
        tokenAmountInAfterFee: poolOutAfterFee,
        tokenAmountFee: poolOutFee,
      } = await pool.calcAmountWithCommunityFee(swapEthToPiptInputs.poolOut, communityJoinFee, ethPiptSwap.address);

      let res = await ethPiptSwap.swapEthToPipt(slippage, { from: bob, value: ethToSwap, gasPrice });

      let weiUsed = res.receipt.gasUsed * gasPrice;
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
      balanceAfterWeiUsed = subBN(bobBalanceBefore, weiUsed);

      assert.equal(addBN(balanceAfterWeiUsed, ethOutAfterFee), await web3.eth.getBalance(bob));
      assert.equal(await this.weth.balanceOf(ethPiptSwap.address), ethOutFee);

      cvpOutForReceiver = await this.getPairAmountOut(cvpPair, ethOutFee);

      await ethPiptSwap.convertOddToCvpAndSendToPayout([], { from: bob });
      assert.equal(await this.weth.balanceOf(ethPiptSwap.address), '0');

      const feeReceiverBalanceSwapOut = await cvp.balanceOf(feeReceiver);
      assert.equal(addBN(feeReceiverBalanceSwapIn, cvpOutForReceiver), feeReceiverBalanceSwapOut);
    });

    it('swapErc20ToPipt should work properly', async () => {
      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('200').toString(10)], { from: minter });

      const erc20PiptSwap = await Erc20PiptSwap.new(this.weth.address, cvp.address, pool.address, feeManager, {
        from: minter,
      });

      await erc20PiptSwap.setFees([ether('100'), ether('1')], [ether('0.01'), ether('0.005')], feeReceiver, feeManager, {
        from: feeManager,
      });

      assert.equal(await erc20PiptSwap.uniswapFactoryAllowed(this.uniswapFactory.address), false);
      await expectRevert(erc20PiptSwap.fetchUnswapPairsFromFactory(
        this.uniswapFactory.address,
        tokens.map(t => t.address),
        { from: bob },
      ), 'FACTORY_NOT_ALLOWED');

      await expectRevert(erc20PiptSwap.setUniswapFactoryAllowed(
        [this.uniswapFactory.address],
        [true],
        { from: bob },
      ), 'Ownable: caller is not the owner');

      await erc20PiptSwap.setUniswapFactoryAllowed(
        [this.uniswapFactory.address],
        [true],
        { from: minter },
      );
      assert.equal(await erc20PiptSwap.uniswapFactoryAllowed(this.uniswapFactory.address), true);

      await erc20PiptSwap.fetchUnswapPairsFromFactory(
        this.uniswapFactory.address,
        tokens.map(t => t.address),
        { from: bob },
      )

      const {token: usdcToken, pair: usdcPair} = tokenBySymbol['USDC'];

      const tokenAddress = usdcToken.address;
      const amountToSwap = (100 * 10 ** 6).toString(10);
      const slippage = ether('0.02');

      await usdcToken.transfer(bob, amountToSwap);

      const {
        erc20Fee: erc20InFee,
        erc20AfterFee: erc20InAfterFee,
        ethFee,
        ethAfterFee
      } = await erc20PiptSwap.calcErc20Fee(tokenAddress, amountToSwap);

      const { _reserve0: tokenReserve, _reserve1: ethReserve } = await usdcPair.getReserves();
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

      let bobBalanceBefore = await usdcToken.balanceOf(bob);

      const {
        tokenAmountInAfterFee: poolOutAfterFee,
        tokenAmountFee: poolOutFee,
      } = await pool.calcAmountWithCommunityFee(swapErc20ToPiptInputs.poolOut, communityJoinFee, erc20PiptSwap.address);

      await usdcToken.approve(erc20PiptSwap.address, amountToSwap, { from: bob });

      let res = await erc20PiptSwap.swapErc20ToPipt(tokenAddress, amountToSwap, slippage, { from: bob, gasPrice });

      assert.equal(subBN(bobBalanceBefore, amountToSwap), await usdcToken.balanceOf(bob));
      assert.equal(await this.weth.balanceOf(erc20PiptSwap.address), ethFee);

      const swap = res.receipt.logs.filter(l => l.event === 'EthToPiptSwap')[0].args;
      assert.equal(swap.ethSwapFee, ethFee);
      assert.equal(swap.ethInAmount, ethAfterFee);
      assert.equal(swap.poolOutAmount, swapErc20ToPiptInputs.poolOut);
      assert.equal(swap.poolCommunityFee, poolOutFee);

      const erc20Swap = res.receipt.logs.filter(l => l.event === 'Erc20ToPiptSwap')[0].args;
      assert.equal(erc20Swap.erc20InAmount, amountToSwap);
      assert.equal(erc20Swap.ethInAmount, addBN(ethFee, ethAfterFee));
      assert.equal(erc20Swap.poolOutAmount, swapErc20ToPiptInputs.poolOut);

      assert.equal(poolOutAfterFee, await pool.balanceOf(bob));

      const swapPiptToEthInputs = await erc20PiptSwap.calcSwapPiptToErc20Inputs(
        tokenAddress,
        poolOutAfterFee,
        balancerTokens.map(t => t.address),
        true,
      );

      await pool.approve(erc20PiptSwap.address, poolOutAfterFee, { from: bob });

      bobBalanceBefore = await usdcToken.balanceOf(bob);
      await erc20PiptSwap.swapPiptToErc20(tokenAddress, poolOutAfterFee, { from: bob, gasPrice });

      assert.equal(addBN(bobBalanceBefore, swapPiptToEthInputs.totalErc20Out), await usdcToken.balanceOf(bob));
      assert.equal(await pool.balanceOf(bob), '0');
    });

    it('BPool should prevent double swap in same transaction by EthPiptSwap', async () => {
      await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('200').toString(10)], { from: minter });

      const ethPiptSwap = await EthPiptSwap.new(this.weth.address, cvp.address, pool.address, feeManager, {
        from: minter,
      });

      await ethPiptSwap.setUniswapFactoryAllowed(
        [this.uniswapFactory.address],
        [true],
        { from: minter },
      );

      await ethPiptSwap.fetchUnswapPairsFromFactory(
        this.uniswapFactory.address,
        tokens.map(t => t.address),
        { from: bob },
      )

      const mockClient = await MockBPoolClient.new();
      await expectRevert(
        mockClient.callBPoolTwice(ethPiptSwap.address, { from: minter, value: ether('1') }),
        'SAME_TX_ORIGIN',
      );
    })
  });
});
