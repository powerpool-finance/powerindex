const fs = require('fs');
const { deployProxied, mwei, addBN, subBN, mulScalarBN, divScalarBN, mulBN, divBN, assertEqualWithAccuracy } = require('./helpers');

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
const ProxyFactory = artifacts.require('ProxyFactory');
const IndicesSupplyRedeemZap = artifacts.require('IndicesSupplyRedeemZap');
const MockPoke = artifacts.require('MockPoke');
const MockVault = artifacts.require('MockVault');
const MockVaultDepositor2 = artifacts.require('MockVaultDepositor2');
const MockVaultDepositor3 = artifacts.require('MockVaultDepositor3');
const MockVaultDepositor4 = artifacts.require('MockVaultDepositor4');
const MockVaultRegistry = artifacts.require('MockVaultRegistry');

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
function szabo(val) {
  return web3.utils.toWei(val.toString(), 'szabo');
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

describe.only('IndicesSupplyRedeemZap', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  let ETH;
  const swapFee = ether('0.0001');
  const communitySwapFee = ether('0.001');
  const communityJoinFee = ether('0.001');
  const communityExitFee = ether('0.001');

  const poolsData = JSON.parse(fs.readFileSync('data/poolsData.json', { encoding: 'utf8' }));

  const roundPeriod = 60;

  let minter, alice, bob, dan, carol, feeManager, feeReceiver, permanentVotingPower;
  before(async function () {
    [minter, alice, bob, dan, carol, feeManager, feeReceiver, permanentVotingPower] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();
    await this.weth.deposit({ value: ether('50000000') });

    this.poke = await MockPoke.new();

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

  describe('Swaps with Uniswap mainnet values', () => {
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
        [roundPeriod, feeReceiver],
        {proxyAdminOwner: minter}
      );

      ETH = await this.indiciesZap.ETH();

      await time.increase(12 * 60 * 60);
    });

    it('swapEthToPipt should work properly', async () => {
      const aliceEthToSwap = ether(10);
      const bobEthToSwap = ether(20);

      const danUsdcToSwap = mwei(10000);
      const carolUsdcToSwap = mwei(5000);

      const erc20PiptSwap = await Erc20PiptSwap.new(this.weth.address, cvp.address, pool.address, zeroAddress, feeManager, {
        from: minter,
      });

      await erc20PiptSwap.fetchUnswapPairsFromFactory(
        this.uniswapFactory.address,
        tokens.map(t => t.address),
        { from: minter },
      );

      await erc20PiptSwap.setTokensSettings(
        tokens.map(t => t.address),
        pairs.map(p => p.address),
        pairs.map(() => true),
        { from: minter },
      );

      await this.indiciesZap.setPools([pool.address], ['1'], {from: minter});
      await this.indiciesZap.setPoolsPiptSwap([pool.address], [erc20PiptSwap.address], {from: minter});

      const firstRoundEthKey = await this.indiciesZap.getRoundKey('1', pool.address, ETH, pool.address);
      const firstRoundUsdcKey = await this.indiciesZap.getRoundKey('1', pool.address, usdc.address, pool.address);

      assert.notEqual(firstRoundEthKey, firstRoundUsdcKey);

      let res = await this.indiciesZap.depositEth(pool.address, { value: aliceEthToSwap, from: alice });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'NewRound', {
        id: '1',
      });
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRoundKey', {
        id: '1',
        key: firstRoundEthKey,
        pool: pool.address,
        inputToken: ETH,
        outputToken: pool.address
      });

      let round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.id, '1');
      assert.equal(round.pool, pool.address);
      assert.equal(round.inputToken, ETH);
      assert.equal(round.outputToken, pool.address);
      assert.equal(round.totalInputAmount, aliceEthToSwap);
      assert.equal(round.totalOutputAmount, '0');

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, alice), aliceEthToSwap);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, bob), '0');

      await expectRevert(this.indiciesZap.depositErc20(pool.address, await this.indiciesZap.ETH(), ether(10), { from: alice }), 'NOT_SUPPORTED_TOKEN');
      await expectRevert(this.indiciesZap.depositErc20(pool.address, alice, ether(10), { from: alice }), 'NOT_SUPPORTED_TOKEN');

      res = await this.indiciesZap.depositEth(pool.address, { value: bobEthToSwap, from: bob });
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'NewRound');
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRoundKey');

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, alice), aliceEthToSwap);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, bob), bobEthToSwap);

      const totalEthToSwap = addBN(aliceEthToSwap, bobEthToSwap);

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.totalInputAmount, totalEthToSwap);
      assert.equal(round.totalOutputAmount, '0');

      await usdc.transfer(dan, danUsdcToSwap, {from: minter});
      await usdc.approve(this.indiciesZap.address, danUsdcToSwap, {from: dan});
      await usdc.transfer(carol, mulBN(carolUsdcToSwap, '3'), {from: minter});
      await usdc.approve(this.indiciesZap.address, mulBN(carolUsdcToSwap, '3'), {from: carol});

      res = await this.indiciesZap.depositErc20(pool.address, usdc.address, danUsdcToSwap, { from: dan });
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'NewRound');
      await expectEvent.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRoundKey', {
        id: '1',
        key: firstRoundUsdcKey,
        pool: pool.address,
        inputToken: usdc.address,
        outputToken: pool.address
      });

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.id, '1');
      assert.equal(round.pool, pool.address);
      assert.equal(round.inputToken, usdc.address);
      assert.equal(round.outputToken, pool.address);
      assert.equal(round.totalInputAmount, danUsdcToSwap);

      res = await this.indiciesZap.depositErc20(pool.address, usdc.address, mulBN(carolUsdcToSwap, '3'), { from: carol });
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'NewRound');
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRoundKey');

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, addBN(mulBN(carolUsdcToSwap, '3'), danUsdcToSwap));

      await expectRevert(this.indiciesZap.withdrawErc20(pool.address, usdc.address, mulBN(carolUsdcToSwap, '4'), { from: carol }), ' subtraction overflow');
      await expectRevert(this.indiciesZap.withdrawErc20(pool.address, usdc.address, carolUsdcToSwap, { from: alice }), ' subtraction overflow');

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, carol), '0');
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundUsdcKey, carol), mulBN(carolUsdcToSwap, '3'));

      res = await this.indiciesZap.withdrawErc20(pool.address, usdc.address, subBN(mulBN(carolUsdcToSwap, '3'), carolUsdcToSwap), { from: carol });
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'NewRound');
      await expectEvent.notEmitted.inTransaction(res.tx, IndicesSupplyRedeemZap, 'InitRoundKey');

      await expectRevert(this.indiciesZap.withdrawErc20(pool.address, usdc.address, mulBN(carolUsdcToSwap, '3'), { from: carol }), ' subtraction overflow');

      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundEthKey, carol), '0');
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundUsdcKey, dan), danUsdcToSwap);
      assert.equal(await this.indiciesZap.getRoundUserInput(firstRoundUsdcKey, carol), carolUsdcToSwap);

      const totalUsdcToSwap = addBN(danUsdcToSwap, carolUsdcToSwap);

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, totalUsdcToSwap);

      await time.increase(roundPeriod);

      await expectRevert(this.indiciesZap.claimPoke(firstRoundEthKey, [alice, bob]), 'TOTAL_OUTPUT_NULL');
      await expectRevert(this.indiciesZap.claimPoke(firstRoundUsdcKey, [dan, carol]), 'TOTAL_OUTPUT_NULL');

      await this.indiciesZap.supplyAndRedeemPoke([firstRoundEthKey]);
      assert.equal(await pool.balanceOf(alice), '0');
      assert.equal(await pool.balanceOf(bob), '0');

      const { ethAfterFee: ethInAfterFee } = await erc20PiptSwap.calcEthFee(totalEthToSwap);
      const {poolOut: poolOutForEth} = await erc20PiptSwap.calcSwapEthToPiptInputs(
        ethInAfterFee,
        balancerTokens.map(t => t.address),
        await erc20PiptSwap.defaultSlippage(),
      );

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assertEqualWithAccuracy(round.totalOutputAmount, poolOutForEth, ether('0.05'));
      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalOutputAmount, '0');

      await this.indiciesZap.claimPoke(firstRoundEthKey, [alice, bob]);
      assertEqualWithAccuracy(await pool.balanceOf(alice), divBN(mulBN(poolOutForEth, aliceEthToSwap), totalEthToSwap), ether('0.05'));
      assertEqualWithAccuracy(await pool.balanceOf(bob), divBN(mulBN(poolOutForEth, bobEthToSwap), totalEthToSwap), ether('0.05'));

      assertEqualWithAccuracy(await this.indiciesZap.getRoundUserOutput(firstRoundEthKey, alice), await pool.balanceOf(alice), ether('0.0000001'));
      assertEqualWithAccuracy(await this.indiciesZap.getRoundUserOutput(firstRoundEthKey, bob), await pool.balanceOf(bob), ether('0.0000001'));

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assertEqualWithAccuracy(round.totalOutputAmount, poolOutForEth, ether('0.05'));
      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalOutputAmount, '0');

      await expectRevert(this.indiciesZap.claimPoke(firstRoundEthKey, [dan, carol]), 'INPUT_NULL');
      await expectRevert(this.indiciesZap.claimPoke(firstRoundUsdcKey, [dan, carol]), 'TOTAL_OUTPUT_NULL');

      const { erc20AfterFee: usdcInAfterFee } = await erc20PiptSwap.calcErc20Fee(usdc.address, totalUsdcToSwap);
      const {poolOut: poolOutForUsdc} = await erc20PiptSwap.calcSwapErc20ToPiptInputs(
        usdc.address,
        usdcInAfterFee,
        balancerTokens.map(t => t.address),
        await erc20PiptSwap.defaultSlippage(),
        true
      );

      await this.indiciesZap.supplyAndRedeemPoke([firstRoundUsdcKey]);

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assertEqualWithAccuracy(round.totalOutputAmount, poolOutForUsdc, ether('0.05'));

      await this.indiciesZap.claimPoke(firstRoundUsdcKey, [dan, carol]);
      assertEqualWithAccuracy(await pool.balanceOf(dan), divBN(mulBN(poolOutForUsdc, danUsdcToSwap), totalUsdcToSwap), ether('0.05'));
      assertEqualWithAccuracy(await pool.balanceOf(carol), divBN(mulBN(poolOutForUsdc, carolUsdcToSwap), totalUsdcToSwap), ether('0.05'));

      assertEqualWithAccuracy(await this.indiciesZap.getRoundUserOutput(firstRoundUsdcKey, dan), await pool.balanceOf(dan), ether('0.0000001'));
      assertEqualWithAccuracy(await this.indiciesZap.getRoundUserOutput(firstRoundUsdcKey, carol), await pool.balanceOf(carol), ether('0.0000001'));
    });
  });

  describe.skip('Swaps with Uniswap mainnet values', () => {
    let usdc, tokens, balancerTokens, vaults, bPoolBalances, pool;

    beforeEach(async () => {
      tokens = [];
      balancerTokens = [];
      vaults = [];
      bPoolBalances = [];
      const vaultsData = JSON.parse(fs.readFileSync('data/vaultsData.json', { encoding: 'utf8' }));

      usdc = await MockERC20.new('USDC', 'USDC', '18', ether('50000000'));

      const vaultRegistry = await MockVaultRegistry.new();
      for (let i = 0; i < vaultsData.length; i++) {
        const v = vaultsData[i];
        const lpToken = await MockERC20.new("", "", '18', v.totalSupply);
        const vault = await MockVault.new(lpToken.address, v.usdtValue, v.totalSupply);
        let depositor;
        if (v.config.amountsLength === 2) {
          depositor = await MockVaultDepositor2.new(lpToken.address, usdc.address, v.config.usdcIndex, szabo(v.usdcToLpRate));
        } else if (v.config.amountsLength === 3) {
          depositor = await MockVaultDepositor3.new(lpToken.address, usdc.address, v.config.usdcIndex, szabo(v.usdcToLpRate));
        } else if (v.config.amountsLength === 4) {
          depositor = await MockVaultDepositor4.new(lpToken.address, usdc.address, v.config.usdcIndex, szabo(v.usdcToLpRate));
        }
        await lpToken.transfer(depositor.address, v.totalSupply);
        await vaultRegistry.set_virtual_price(lpToken.address, szabo(v.usdcToLpRate));

        vaults.push({
          lpToken,
          vault,
          depositor,
          config: v.config,
        })
        tokens.push(vault);
        bPoolBalances.push(poolsData[i].balancerBalance);
      }
      balancerTokens = tokens;

      pool = await this.makePowerIndexPool(tokens, bPoolBalances);

      this.indiciesZap = await deployProxied(
        IndicesSupplyRedeemZap,
        [usdc.address, this.poke.address],
        [roundPeriod, feeReceiver],
        {proxyAdminOwner: minter}
      );

      ETH = await this.indiciesZap.ETH();

      await this.indiciesZap.setVaultConfigs(
        vaults.map(v => v.vault.address),
        vaults.map(v => v.depositor.address),
        vaults.map(v => v.config.amountsLength),
        vaults.map(v => v.config.usdcIndex),
        vaults.map(v => v.lpToken.address),
        vaults.map(v => vaultRegistry.address),
      );

      await time.increase(12 * 60 * 60);
    });

    it('swapEthToPipt should work properly', async () => {
      const erc20PiptSwap = await Erc20PiptSwap.new(this.weth.address, usdc.address, pool.address, zeroAddress, feeManager, {
        from: minter,
      });

      await this.indiciesZap.setPools([pool.address], ['2'], {from: minter});
      await this.indiciesZap.setPoolsPiptSwap([pool.address], [erc20PiptSwap.address], {from: minter});

      const firstRoundEthKey = await this.indiciesZap.getRoundKey('1', pool.address, ETH, pool.address);
      const firstRoundUsdcKey = await this.indiciesZap.getRoundKey('1', pool.address, usdc.address, pool.address);

      assert.notEqual(firstRoundEthKey, firstRoundUsdcKey);

      await expectRevert(this.indiciesZap.depositEth(pool.address, { value: ether('1'), from: alice }), 'NOT_SUPPORTED_POOL');

      await usdc.transfer(dan, mwei('1000'), {from: minter});
      await usdc.approve(this.indiciesZap.address, mwei('1000'), {from: dan});
      await usdc.transfer(carol, mwei('2000'), {from: minter});
      await usdc.approve(this.indiciesZap.address, mwei('2000'), {from: carol});

      await this.indiciesZap.depositErc20(pool.address, usdc.address, mwei('1000'), { from: dan });

      await this.indiciesZap.depositErc20(pool.address, usdc.address, mwei('2000'), { from: carol });

      let round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, mwei('3000'));

      await this.indiciesZap.withdrawErc20(pool.address, usdc.address, mwei('1500'), { from: carol });

      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalInputAmount, mwei('1500'));

      await time.increase(roundPeriod);

      await expectRevert(this.indiciesZap.claimPoke(firstRoundEthKey, [alice, bob]), 'TOTAL_OUTPUT_NULL');
      await expectRevert(this.indiciesZap.claimPoke(firstRoundUsdcKey, [dan, carol]), 'TOTAL_OUTPUT_NULL');

      await this.indiciesZap.supplyAndRedeemPoke([firstRoundUsdcKey]);
      assert.equal(await pool.balanceOf(alice), '0');
      assert.equal(await pool.balanceOf(bob), '0');

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.totalOutputAmount, ether('0.03094770810646647'));
      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalOutputAmount, '0');

      await this.indiciesZap.claimPoke(firstRoundEthKey, [alice, bob]);
      assert.equal(await pool.balanceOf(alice), ether('0.010315902702155488'));
      assert.equal(await pool.balanceOf(bob), ether('0.020631805404310978'));

      assert.equal(await this.indiciesZap.getRoundUserOutput(firstRoundEthKey, alice), ether('0.010315902702155489'));
      assert.equal(await this.indiciesZap.getRoundUserOutput(firstRoundEthKey, bob), ether('0.020631805404310979'));

      round = await this.indiciesZap.rounds(firstRoundEthKey);
      assert.equal(round.totalOutputAmount, ether('0.03094770810646647'));
      round = await this.indiciesZap.rounds(firstRoundUsdcKey);
      assert.equal(round.totalOutputAmount, '0');

      await expectRevert(this.indiciesZap.claimPoke(firstRoundEthKey, [dan, carol]), 'INPUT_NULL');
      await expectRevert(this.indiciesZap.claimPoke(firstRoundUsdcKey, [dan, carol]), 'TOTAL_OUTPUT_NULL');

      await this.indiciesZap.supplyAndRedeemPoke([firstRoundUsdcKey]);

      await this.indiciesZap.claimPoke(firstRoundUsdcKey, [dan, carol]);
      assert.equal(await pool.balanceOf(dan), ether('0.007645055183580519'));
      assert.equal(await pool.balanceOf(carol), ether('0.003822527591790259'));
    });
  });
});
