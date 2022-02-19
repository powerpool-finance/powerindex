const fs = require('fs');
const { mwei, assertEqualWithAccuracy, addBN } = require('./helpers');

const { time, expectRevert } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const MockERC20 = artifacts.require('MockERC20');
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
Erc20VaultPoolSwap.numberFormat = 'String';
MockVault.numberFormat = 'String';

const { web3 } = PowerIndexPoolFactory;

function ether(val) {
  return web3.utils.toWei(val.toString(), 'ether');
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

describe('Erc20VaultPoolSwap', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const swapFee = ether('0.0001');
  const communitySwapFee = ether('0.001');
  const communityJoinFee = ether('0.001');
  const communityExitFee = ether('0.001');

  const poolsData = JSON.parse(fs.readFileSync('data/poolsData.json', { encoding: 'utf8' }));

  const slasherInterval = 15 * 60;

  let minter, alice, dan, reporter, slasher, permanentVotingPower;
  before(async function () {
    [minter, alice, dan, reporter, slasher, permanentVotingPower] = await web3.eth.getAccounts();
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
  });

  describe('Supply and Redeem of VAULT pool', () => {
    let usdc, tokens, vaults, bPoolBalances, pool, vaultRegistry;

    beforeEach(async () => {
      tokens = [];
      vaults = [];
      bPoolBalances = [];
      const vaultsData = JSON.parse(fs.readFileSync('data/vaultsData.json', { encoding: 'utf8' }));

      usdc = await MockERC20.new('USDC', 'USDC', '18', ether('50000000'));

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

      await time.increase(12 * 60 * 60);
    });

    it('should deposit, withdraw, supply, redeem and claim correctly', async () => {
      const vaultPoolSwap = await Erc20VaultPoolSwap.new(usdc.address, {
        from: minter,
      });
      await vaultPoolSwap.setVaultConfigs(
        vaults.map(v => v.vault.address),
        vaults.map(v => ({
          depositorLength: v.config.amountsLength,
          depositorIndex: v.config.usdcIndex,
          depositorType: v.config.depositorType || 1,
          depositor: v.depositor.address,
          lpToken: v.lpToken.address,
          curvePoolRegistry: vaultRegistry.address,
        })),
      );
      await vaultPoolSwap.updatePools([pool.address]);

      const danUsdcSwap = mwei('1000');

      await usdc.transfer(dan, danUsdcSwap, {from: minter});
      await usdc.approve(vaultPoolSwap.address, danUsdcSwap, {from: dan});

      const vaultPoolOut = await vaultPoolSwap.calcVaultPoolOutByUsdc(pool.address, danUsdcSwap, true);
      await expectRevert(vaultPoolSwap.swapErc20ToVaultPool(pool.address, usdc.address, '0', vaultPoolOut, {from: dan}), 'NULL_INPUT');
      await expectRevert(vaultPoolSwap.swapErc20ToVaultPool(pool.address, usdc.address, danUsdcSwap, vaultPoolOut, {from: alice}), 'ERC20');
      for (let i = 0; i < tokens.length; i++) {
        await tokens[i].transfer(vaultPoolSwap.address, ether(1000));
      }
      await expectRevert(vaultPoolSwap.swapErc20ToVaultPool(pool.address, usdc.address, danUsdcSwap, addBN(vaultPoolOut, ether('0.0001')), {from: dan}), 'POOL_AMOUNT_OUT_MIN');
      await vaultPoolSwap.swapErc20ToVaultPool(pool.address, usdc.address, danUsdcSwap, vaultPoolOut, {from: dan});
      const danPoolBalance = await pool.balanceOf(dan);
      assertEqualWithAccuracy(vaultPoolOut, danPoolBalance, ether('0.0000011'));

      for (let i = 0; i < tokens.length; i++) {
        assertEqualWithAccuracy(await tokens[i].balanceOf(vaultPoolSwap.address), ether([
          '1000.009495032126027295',
          '1000.000001000000000018',
          '1000.15767685969318884',
          '1001.2679124215749662',
          '1000.009121499191673045'
        ][i]), ether('0.002'));
      }

      await pool.approve(vaultPoolSwap.address, danPoolBalance, {from: dan});
      const usdcOut = await vaultPoolSwap.calcUsdcOutByPool(pool.address, danPoolBalance, true);
      await expectRevert(vaultPoolSwap.swapVaultPoolToErc20(pool.address, '0', usdc.address, usdcOut, {from: dan}), 'NULL_INPUT');
      await expectRevert(vaultPoolSwap.swapVaultPoolToErc20(pool.address, danPoolBalance, usdc.address, usdcOut, {from: alice}), 'ERR_BTOKEN_BAD_CALLER');
      await expectRevert(vaultPoolSwap.swapVaultPoolToErc20(pool.address, danPoolBalance, usdc.address, addBN(usdcOut, ether('1')), {from: dan}), 'ERC20_AMOUNT_OUT_MIN');
      await vaultPoolSwap.swapVaultPoolToErc20(pool.address, danPoolBalance, usdc.address, usdcOut, {from: dan});
      const danUsdcBalance = await usdc.balanceOf(dan);
      assertEqualWithAccuracy(usdcOut, danUsdcBalance, ether('0.002'));

      for (let i = 0; i < tokens.length; i++) {
        assertEqualWithAccuracy(await tokens[i].balanceOf(vaultPoolSwap.address), ether([
          '1000.009495032126027295',
          '1000.000001000000000018',
          '1000.15767685969318884',
          '1001.2679124215749662',
          '1000.009121499191673045'
        ][i]), ether('0.002'));
      }

      await expectRevert(vaultPoolSwap.claimFee(tokens.map(t => t.address), {from: dan}), 'Ownable');
      await expectRevert(vaultPoolSwap.claimFee(tokens.map(t => t.address), {from: minter}), 'FP_NOT_SET');
      await vaultPoolSwap.setFees([], [], permanentVotingPower, minter, {from: minter});
      await vaultPoolSwap.claimFee(tokens.map(t => t.address), {from: minter});

      for (let i = 0; i < tokens.length; i++) {
        assertEqualWithAccuracy(await tokens[i].balanceOf(permanentVotingPower), ether([
          '1000.009495032126027295',
          '1000.000001000000000018',
          '1000.15767685969318884',
          '1001.2679124215749662',
          '1000.009121499191673045'
        ][i]), ether('0.002'));
        assert.equal(await tokens[i].balanceOf(vaultPoolSwap.address), '0')
      }
    });
  });
});
