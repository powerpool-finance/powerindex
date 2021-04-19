const fs = require('fs');

const { time, expectRevert, expectEvent, constants } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const PowerIndexPoolFactory = artifacts.require('PowerIndexPoolFactory');
const PowerIndexPoolActions = artifacts.require('PowerIndexPoolActions');
const PowerIndexPool = artifacts.require('PowerIndexPool');
const MockERC20 = artifacts.require('MockERC20');
const MockPool = artifacts.require('MockPool');
const WETH = artifacts.require('MockWETH');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const ProxyFactory = artifacts.require('ProxyFactory');
const MockYearnVaultInstantRebindStrategy = artifacts.require('MockYearnVaultInstantRebindStrategy');
const MockOracle = artifacts.require('MockOracle');
const PowerPoke = artifacts.require('PowerPoke');
const MockFastGasOracle = artifacts.require('MockFastGasOracle');
const MockStaking = artifacts.require('MockStaking');
const MockCvp = artifacts.require('MockCvp');
const MockVault = artifacts.require('MockVault');
const MockCurveDepositor2 = artifacts.require('MockCurveDepositor2');
const MockCurveDepositor3 = artifacts.require('MockCurveDepositor3');
const MockCurveDepositor4 = artifacts.require('MockCurveDepositor4');
const MockYearnVaultV1 = artifacts.require('MockYearnVaultV1');
const MockYearnVaultController = artifacts.require('MockYearnVaultController');
const MockCurvePoolRegistry = artifacts.require('MockCurvePoolRegistry');
const { deployProxied, gwei } = require('../helpers');

WETH.numberFormat = 'String';
MockERC20.numberFormat = 'String';
PowerIndexPool.numberFormat = 'String';
PowerPoke.numberFormat = 'String';
MockYearnVaultV1.numberFormat = 'String';
MockYearnVaultController.numberFormat = 'String';
MockCurveDepositor2.numberFormat = 'String';
MockCurveDepositor3.numberFormat = 'String';
MockCurveDepositor4.numberFormat = 'String';
MockCurvePoolRegistry.numberFormat = 'String';
MockYearnVaultInstantRebindStrategy.numberFormat = 'String';

const { web3 } = PowerIndexPoolFactory;

function ether(val) {
  return web3.utils.toWei(val.toString(), 'ether').toString();
}

function mwei(val) {
  return web3.utils.toWei(val.toString(), 'mwei').toString();
}

async function getTimestamp(shift = 0) {
  const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
  return currentTimestamp + shift;
}

describe('Yearn Vault Instant Rebind Strategy', () => {
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const swapFee = ether('0.0001');
  const communitySwapFee = ether('0.001');
  const communityJoinFee = ether('0.001');
  const communityExitFee = ether('0.001');

  const pokePeriod = 7 * 60 * 60 * 24;

  const slasherDeposit = ether(10000);
  const reporterDeposit = ether(20000);

  let minter, alice, stub, permanentVotingPower, strategyOwner, reporter, slasher, reservoir;
  before(async function() {
    [
      minter,
      alice,
      stub,
      permanentVotingPower,
      strategyOwner,
      reporter,
      slasher,
      reservoir,
    ] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.weth = await WETH.new();
    this.weth.deposit({ value: ether('50000000') });

    const proxyFactory = await ProxyFactory.new();
    const impl = await PowerIndexPool.new();
    this.bFactory = await PowerIndexPoolFactory.new(proxyFactory.address, impl.address, zeroAddress, { from: minter });
    this.bActions = await PowerIndexPoolActions.new({ from: minter });

    this.poolRestrictions = await PoolRestrictions.new();
    this.cvpToken = await MockCvp.new();

    this.initInstantRebindStrategy = async (strategy, pool, poolController, poke) => {
      await pool.setController(poolController.address);
      await poolController.setWeightsStrategy(strategy.address);
      await poke.addClient(strategy.address, strategyOwner, true, gwei(300), pokePeriod, pokePeriod * 2, {
        from: minter,
      });
      await this.cvpToken.approve(poke.address, ether(30000), { from: minter });
      await poke.addCredit(strategy.address, ether(30000), { from: minter });
      await poke.setBonusPlan(strategy.address, 1, true, 20, 17520000, 100 * 1000, { from: strategyOwner });
      await poke.setMinimalDeposit(strategy.address, slasherDeposit, { from: strategyOwner });
      await strategy.syncPoolTokens();
    };

    this.makePowerIndexPool = async (_tokens, _balances, _totalDenormalizedWeight = 50, _customWeights = []) => {
      const fromTimestamp = await getTimestamp(100);
      const targetTimestamp = await getTimestamp(100 + 60 * 60 * 24 * 5);
      for (let i = 0; i < _tokens.length; i++) {
        await _tokens[i].approve(this.bActions.address, '0x' + 'f'.repeat(64));
      }

      const weightPart = _totalDenormalizedWeight / _tokens.length;
      const minWeightPerSecond = ether('0');
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
          targetDenorm: _customWeights && _customWeights.length > 0 ? _customWeights[i] : ether(weightPart),
          fromTimestamp: fromTimestamp.toString(),
          targetTimestamp: targetTimestamp.toString(),
        })),
      );

      const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(
        l => l.event === 'LOG_NEW_POOL',
      )[0];
      const pool = await PowerIndexPool.at(logNewPool.args.pool);
      await pool.setRestrictions(this.poolRestrictions.address, { from: minter });

      return pool;
    };
  });

  describe('Without initialized pool', () => {
    let strategy;
    let pool;
    let vault;

    beforeEach(async () => {
      vault = await MockVault.new(stub, ether(10), ether(10));
      pool = await MockPool.new();
      await pool.setCurrentTokens([vault.address]);
      strategy = await deployProxied(
        MockYearnVaultInstantRebindStrategy,
        // [pool, usdc]
        [pool.address, stub],
        [
          // powerPoke
          stub,
          // curvePoolRegistry
          stub,
          // poolController
          stub,
          {
            minUSDCRemainder: mwei('5'),
            useVirtualPriceEstimation: false,
          },
        ],
        { proxyAdminOwner: minter },
      );
      await strategy.syncPoolTokens();
    });

    describe('setCurvePoolRegistry()', () => {
      it('should allow the owner setting a new curvePoolRegistry', async () => {
        const res = await strategy.setCurvePoolRegistry(alice, { from: minter });
        assert.equal(await strategy.curvePoolRegistry(), alice);
        expectEvent(res, 'SetCurvePoolRegistry', {
          curvePoolRegistry: alice,
        });
        await expectRevert(strategy.setCurvePoolRegistry(alice, { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setStrategyConstraints', () => {
      it('should allow the owner setting a new strategy constraints', async () => {
        let constraints = await strategy.constraints();
        assert.equal(constraints.minUSDCRemainder, mwei(5));
        assert.equal(constraints.useVirtualPriceEstimation, false);

        const res = await strategy.setStrategyConstraints(
          {
            minUSDCRemainder: 42,
            useVirtualPriceEstimation: true,
          },
          { from: minter },
        );

        constraints = await strategy.constraints();
        assert.equal(constraints.minUSDCRemainder, '42');
        assert.equal(constraints.useVirtualPriceEstimation, true);
        expectEvent(res, 'SetStrategyConstraints', {
          minUSDCRemainder: '42',
          useVirtualPriceEstimation: true,
        });
        await expectRevert(
          strategy.setStrategyConstraints(
            {
              minUSDCRemainder: 42,
              useVirtualPriceEstimation: true,
            },
            { from: alice },
          ),
          'Ownable: caller is not the owner',
        );
      });
    });

    describe('setPoolController()', () => {
      it('should allow the owner setting a new poolController', async () => {
        const res = await strategy.setPoolController(alice, { from: minter });
        assert.equal(await strategy.poolController(), alice);
        expectEvent(res, 'SetPoolController', {
          poolController: alice,
        });
        await expectRevert(strategy.setPoolController(alice, { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('removeApprovals()', () => {
      it('should allow the owner removing unnecessary approvals', async () => {
        const controller = await strategy.poolController();
        assert.equal(await vault.allowance(strategy.address, pool.address), constants.MAX_UINT256.toString());
        assert.equal(await vault.allowance(strategy.address, controller), constants.MAX_UINT256.toString());
        await strategy.removeApprovals([vault.address, vault.address], [pool.address, controller], { from: minter });
        assert.equal(await vault.allowance(strategy.address, pool.address), '0');
        assert.equal(await vault.allowance(strategy.address, controller), '0');
        await expectRevert(
          strategy.removeApprovals([vault.address, vault.address], [pool.address, controller], { from: alice }),
          'Ownable: caller is not the owner',
        );
      });
    });

    describe('syncPoolTokens()', () => {
      it('should allow the owner syncing tokens of an existing pool', async () => {
        const crv2 = await MockERC20.new('TKN2', 'TKN2', 18, ether(1e16));
        const vault2 = await MockVault.new(crv2.address, ether(10), ether(10));

        const crv3 = await MockERC20.new('TKN3', 'TKN3', 18, ether(1e16));
        const vault3 = await MockVault.new(crv3.address, ether(20), ether(20));
        await pool.setCurrentTokens([vault2.address, vault3.address]);

        const res = await strategy.syncPoolTokens({ from: minter });

        const expectedTokens = [vault2.address, vault3.address];
        expectEvent(res, 'UpdatePool', {
          poolTokensBefore: [vault.address],
          poolTokensAfter: expectedTokens,
        });
        assert.sameMembers(await strategy.getPoolTokens(), expectedTokens);
        assert.sameMembers(await pool.getCurrentTokens(), expectedTokens);

        await expectRevert(strategy.syncPoolTokens({ from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('seizeERC20()', () => {
      it('should allow the owner withdrawing any ERC20', async () => {
        const foo = await MockERC20.new('TKN', 'TKN', 18, ether(1e16));
        const bar = await MockERC20.new('TKN', 'TKN', 18, ether(1e16));
        await foo.transfer(strategy.address, ether(5));
        await bar.transfer(strategy.address, ether(4));

        const res = await strategy.seizeERC20([foo.address, bar.address], [stub, stub], [ether(5), ether(4)], {
          from: minter,
        });
        expectEvent(res, 'SeizeERC20', {
          token: foo.address,
          to: stub,
          amount: ether(5),
        });
        expectEvent(res, 'SeizeERC20', {
          token: bar.address,
          to: stub,
          amount: ether(4),
        });
        assert.equal(await foo.balanceOf(stub), ether(5));
        assert.equal(await bar.balanceOf(stub), ether(4));

        await expectRevert(
          strategy.seizeERC20([foo.address, bar.address], [stub, stub], [ether(5), ether(4)], { from: alice }),
          'Ownable: caller is not the owner',
        );
      });
    });
  });

  describe('With an initialized pool', () => {
    let tokens,
      balancerTokens,
      bPoolBalances,
      pool,
      poolController,
      weightStrategy,
      oracle,
      poke,
      fastGasOracle,
      staking;

    let compensationOpts;

    let usdc;
    let crvTokens;
    let crvDepositors;
    const vaultsData = JSON.parse(fs.readFileSync('data/vaultsData2.json', { encoding: 'utf8' }));

    beforeEach(async () => {
      compensationOpts = web3.eth.abi.encodeParameter(
        {
          PokeRewardOptions: {
            to: 'address',
            compensateInETH: 'bool',
          },
        },
        {
          to: reporter,
          compensateInETH: false,
        },
      );

      oracle = await MockOracle.new();

      fastGasOracle = await MockFastGasOracle.new(gwei(300 * 1000));
      staking = await deployProxied(
        MockStaking,
        [this.cvpToken.address],
        [minter, reservoir, zeroAddress, '0', '0', '60', '60'],
        { proxyAdminOwner: minter },
      );

      await this.cvpToken.transfer(reporter, reporterDeposit);
      await this.cvpToken.approve(staking.address, reporterDeposit, { from: reporter });
      await staking.createUser(reporter, reporter, reporterDeposit, { from: reporter });

      await this.cvpToken.transfer(slasher, slasherDeposit);
      await this.cvpToken.approve(staking.address, slasherDeposit, { from: slasher });
      await staking.createUser(slasher, slasher, slasherDeposit, { from: slasher });

      await time.increase(60);
      await staking.executeDeposit('1', { from: reporter });
      await staking.executeDeposit('2', { from: slasher });

      poke = await deployProxied(
        PowerPoke,
        [this.cvpToken.address, this.weth.address, fastGasOracle.address, stub, staking.address],
        [minter, oracle.address],
        { proxyAdminOwner: minter },
      );

      await staking.setSlasher(poke.address);

      tokens = [];
      balancerTokens = [];
      bPoolBalances = [];

      await oracle.setPrice(this.weth.address, ether(1000));
      await oracle.setPrice(this.cvpToken.address, ether(1.5));
    });

    describe('Weights updating', () => {
      beforeEach(async () => {
        crvTokens = [];
        crvDepositors = [];
        weightStrategy = null;
        usdc = await MockERC20.new('USDC', 'USDC', 6, mwei(1e16));

        const curvePoolRegistry = await MockCurvePoolRegistry.new();
        const depositors = [null, null, MockCurveDepositor2, MockCurveDepositor3, MockCurveDepositor4];
        const denormWeights = [];

        for (let i = 0; i < vaultsData.length; i++) {
          const crvToken = await MockERC20.new(vaultsData[i].name, 'CRV', 18, ether(1e16));
          crvTokens.push(crvToken);
          const crvDepositor = await depositors[vaultsData[i].config.amountsLength].new(
            crvToken.address,
            usdc.address,
            vaultsData[i].config.usdcIndex,
            BigInt(vaultsData[i].curvePool.virtualPrice),
          );
          const ycrvVault = await MockYearnVaultV1.new(crvToken.address, minter);
          await curvePoolRegistry.set_virtual_price(crvToken.address, vaultsData[i].curvePool.virtualPrice);

          const yController = await MockYearnVaultController.new();
          await crvToken.approve(ycrvVault.address, vaultsData[i].yearnVault.totalSupply);
          await ycrvVault.setController(yController.address);
          await ycrvVault.deposit(vaultsData[i].yearnVault.totalSupply);

          await usdc.transfer(crvDepositor.address, mwei(1e12));

          tokens.push(ycrvVault);
          crvDepositors.push(crvDepositor);
          bPoolBalances.push(vaultsData[i].balancerPool.vaultTokenBalance);
          denormWeights.push(ether(5));
        }

        balancerTokens = tokens;

        pool = await this.makePowerIndexPool(tokens, bPoolBalances, 25, denormWeights);
        poolController = await PowerIndexPoolController.new(pool.address, zeroAddress, zeroAddress, zeroAddress);

        weightStrategy = await deployProxied(
          MockYearnVaultInstantRebindStrategy,
          [pool.address, usdc.address],
          [
            poke.address,
            curvePoolRegistry.address,
            poolController.address,
            {
              minUSDCRemainder: mwei('5'),
              useVirtualPriceEstimation: false,
            },
          ],
          { proxyAdminOwner: minter },
        );

        for (let i = 0; i < vaultsData.length; i++) {
          await weightStrategy.setVaultConfig(
            tokens[i].address,
            crvDepositors[i].address,
            vaultsData[i].config.amountsLength,
            vaultsData[i].config.usdcIndex,
          );
        }

        await this.initInstantRebindStrategy(weightStrategy, pool, poolController, poke);

        await time.increase(pokePeriod);
      });

      describe('pokes', () => {
        it('should allow poker', async () => {
          const res = await weightStrategy.pokeFromReporter('1', compensationOpts, { from: reporter });
          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('259758.432129'),
            usdcRemainder: '2',
          });
          await expectRevert(
            weightStrategy.pokeFromReporter('1', compensationOpts, { from: reporter }),
            'MIN_INTERVAL_NOT_REACHED',
          );
        });

        it('should allow slasher', async () => {
          const res = await weightStrategy.pokeFromSlasher('2', compensationOpts, { from: slasher });
          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('259758.432129'),
            usdcRemainder: '2',
          });

          await expectRevert(
            weightStrategy.pokeFromSlasher('2', compensationOpts, { from: slasher }),
            'MIN_INTERVAL_NOT_REACHED',
          );

          await time.increase(pokePeriod + 10);

          await expectRevert(
            weightStrategy.pokeFromSlasher('2', compensationOpts, { from: slasher }),
            'MAX_INTERVAL_NOT_REACHED',
          );
        });
      });

      describe('rebalancing', () => {
        it('should correctly rebalance token balances with all underlying tokens on vault', async () => {
          // BEFORE
          for (let t of balancerTokens) {
            assert.equal(await pool.getDenormalizedWeight(t.address), ether('5'));
            assert.equal(await pool.getNormalizedWeight(t.address), ether('0.2'));
          }

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('351877.534685530208568563')); // Compound
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1602634.818799002025699215')); // 3CRV
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('750001.646239684145098699')); // GUSD
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('1056932.418311209236207428')); // Y
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('438106.326817929161302093')); // BUSD

          // ACTION
          const res = await weightStrategy.mockPoke();

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('259758.432129'),
            usdcRemainder: '2',
          });

          const pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('83064.520893416796979428'));
          assert.equal(pull0.crvAmountExpected, ether('83064.520893416796979428'));
          assert.equal(pull0.crvAmountActual, ether('83064.520893416796979428'));
          assert.equal(pull0.usdcAmount, mwei('91060.241146'));
          assert.equal(pull0.vaultReserve, ether('16389957.259759308131042340'));

          const pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('154534.249541010565563929'));
          assert.equal(pull1.crvAmountExpected, ether('154534.249541010565563929'));
          assert.equal(pull1.crvAmountActual, ether('154534.249541010565563929'));
          assert.equal(pull1.usdcAmount, mwei('168698.190983'));
          assert.equal(pull1.vaultReserve, ether('41657837.378850978367377285'));

          const push0 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[0].address);
          assert.equal(push0.crvToken, crvTokens[0].address);
          assert.equal(push0.vaultAmount, ether('194458.509868012998152705'));
          assert.equal(push0.crvAmount, ether('194458.509868012998152705'));
          assert.equal(push0.usdcAmount, mwei('207142.176826'));

          const push1 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[2].address);
          assert.equal(push1.crvToken, crvTokens[2].address);
          assert.equal(push1.vaultAmount, ether('38059.736324422462606760'));
          assert.equal(push1.crvAmount, ether('38059.736324422462606760'));
          assert.equal(push1.usdcAmount, mwei('38633.149894'));

          const push2 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[1].address);
          assert.equal(push2.crvToken, crvTokens[1].address);
          assert.equal(push2.vaultAmount, ether('13779.524742399514931749'));
          assert.equal(push2.crvAmount, ether('13779.524742399514931749'));
          assert.equal(push2.usdcAmount, mwei('13983.105407'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.132370679337861024'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.373088863460271325'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.181946865339872727'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.224065128438652867'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.088528463423342056'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('3.309266983446525607'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.327221586506783136'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.548671633496818185'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.601628210966321663'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.213211585583551406'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('24.999999999999999997'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('546336.044553543206721268'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1616414.343541401540630964'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('788061.382564106607705459'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('902398.168770198670643499'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('355041.805924512364322665'));
        });

        it('should correctly rebalance with virtual price estimation approach', async () => {
          // BEFORE
          for (let t of balancerTokens) {
            assert.equal(await pool.getDenormalizedWeight(t.address), ether('5'));
            assert.equal(await pool.getNormalizedWeight(t.address), ether('0.2'));
          }

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('351877.534685530208568563')); // Compound
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1602634.818799002025699215')); // 3CRV
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('750001.646239684145098699')); // GUSD
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('1056932.418311209236207428')); // Y
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('438106.326817929161302093')); // BUSD

          await weightStrategy.setStrategyConstraints(
            {
              minUSDCRemainder: 42,
              useVirtualPriceEstimation: true,
            },
            { from: minter },
          );

          // ACTION
          const res = await weightStrategy.mockPoke();

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('259758.432129'),
            usdcRemainder: '1',
          });

          const pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('83064.520893416796979428'));
          assert.equal(pull0.crvAmountExpected, ether('83064.520893416796979428'));
          assert.equal(pull0.crvAmountActual, ether('83064.520893416796979428'));
          assert.equal(pull0.usdcAmount, mwei('91060.241146'));
          assert.equal(pull0.vaultReserve, ether('16389957.259759308131042340'));

          const pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('154534.249541010565563929'));
          assert.equal(pull1.crvAmountExpected, ether('154534.249541010565563929'));
          assert.equal(pull1.crvAmountActual, ether('154534.249541010565563929'));
          assert.equal(pull1.usdcAmount, mwei('168698.190983'));
          assert.equal(pull1.vaultReserve, ether('41657837.378850978367377285'));

          const push0 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[0].address);
          assert.equal(push0.crvToken, crvTokens[0].address);
          assert.equal(push0.vaultAmount, ether('194458.509868012998152705'));
          assert.equal(push0.crvAmount, ether('194458.509868012998152705'));
          assert.equal(push0.usdcAmount, mwei('207142.176826'));

          const push1 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[2].address);
          assert.equal(push1.crvToken, crvTokens[2].address);
          assert.equal(push1.vaultAmount, ether('38059.736324422462606760'));
          assert.equal(push1.crvAmount, ether('38059.736324422462606760'));
          assert.equal(push1.usdcAmount, mwei('38633.149894'));

          const push2 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[1].address);
          assert.equal(push2.crvToken, crvTokens[1].address);
          assert.equal(push2.vaultAmount, ether('13779.524743384955886481'));
          assert.equal(push2.crvAmount, ether('13779.524743384955886481'));
          assert.equal(push2.usdcAmount, mwei('13983.105408'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.132370679337861024'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.373088863460271325'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.181946865339872727'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.224065128438652867'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.088528463423342056'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('3.309266983446525607'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.327221586506783136'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.548671633496818185'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.601628210966321663'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.213211585583551406'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('24.999999999999999997'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('546336.044553543206721268'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1616414.343542386981585696'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('788061.382564106607705459'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('902398.168770198670643499'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('355041.805924512364322665'));
        });

        it('should correctly rebalance token balances with insufficient underlying tokens on vault', async () => {
          for (let i in Object.keys(tokens)) {
            const vault = tokens[i];
            await vault.setMin(9990);

            await vault.earn();

            const vaultController = await MockYearnVaultController.at(await vault.controller());
            await vaultController.setWithdrawRatio(5, 10);
          }

          assert.equal(await crvTokens[3].balanceOf(weightStrategy.address), '0');
          let res = await weightStrategy.mockPoke();

          // leftovers
          for (let i in Object.keys(tokens)) {
            assert.equal(await balancerTokens[i].balanceOf(weightStrategy.address), '0');
            assert.equal(await crvTokens[0].balanceOf(weightStrategy.address), '0');
          }

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('161601.043736'),
            usdcRemainder: '1',
          });
          expectEvent(res, 'VaultWithdrawFee', {
            vaultToken: balancerTokens[4].address,
            crvAmount: ether('33337.281816828744424193'),
          });
          expectEvent(res, 'VaultWithdrawFee', {
            vaultToken: balancerTokens[3].address,
            crvAmount: ether('56438.206081079793598276'),
          });

          const pull0 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('83064.520893416796979428'));
          assert.equal(pull0.crvAmountExpected, ether('83064.520893416796979428'));
          assert.equal(pull0.crvAmountActual, ether('49727.239076588052555235'));
          assert.equal(pull0.usdcAmount, mwei('54513.940887'));
          assert.equal(pull0.vaultReserve, ether('16389.957259759308131043'));

          const pull1 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('154534.249541010565563929'));
          assert.equal(pull1.crvAmountExpected, ether('154534.249541010565563929'));
          assert.equal(pull1.crvAmountActual, ether('98096.043459930771965653'));
          assert.equal(pull1.usdcAmount, mwei('107087.102849'));
          assert.equal(pull1.vaultReserve, ether('41657.837378850978367378'));

          const push0 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[0].address);
          assert.equal(push0.crvToken, crvTokens[0].address);
          assert.equal(push0.vaultAmount, ether('120976.623936932720551528'));
          assert.equal(push0.crvAmount, ether('120976.623936932720551528'));
          assert.equal(push0.usdcAmount, mwei('128867.393072'));

          const push1 = res.logs[5].args;
          assert.equal(res.logs[5].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[2].address);
          assert.equal(push1.crvToken, crvTokens[2].address);
          assert.equal(push1.vaultAmount, ether('23677.741907671639579292'));
          assert.equal(push1.crvAmount, ether('23677.741907671639579292'));
          assert.equal(push1.usdcAmount, mwei('24034.474240'));

          const push2 = res.logs[6].args;
          assert.equal(res.logs[6].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[1].address);
          assert.equal(push2.crvToken, crvTokens[1].address);
          assert.equal(push2.vaultAmount, ether('8572.524719667731010826'));
          assert.equal(push2.crvAmount, ether('8572.524719667731010826'));
          assert.equal(push2.usdcAmount, mwei('8699.176423'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.132370679337861024'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.373088863460271325'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.181946865339872727'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.224065128438652867'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.088528463423342056'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('3.309266983446525607'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.327221586506783136'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.548671633496818185'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.601628210966321663'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.213211585583551406'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('24.999999999999999997'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('472854.158622462929120091'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1611207.343518669756710041'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('773679.388147355784677991'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('902398.168770198670643499'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('355041.805924512364322665'));

          res = await weightStrategy.getFeesToRefund();
          assert.equal(res.length, 2);
          assert.equal(res[0].vaultToken, balancerTokens[4].address);
          assert.equal(res[0].crvToken, crvTokens[4].address);
          assert.equal(res[0].crvAmount, ether('33337.281816828744424193'));

          assert.equal(res[1].vaultToken, balancerTokens[3].address);
          assert.equal(res[1].crvToken, crvTokens[3].address);
          assert.equal(res[1].crvAmount, ether('56438.206081079793598276'));
        });
      });

      describe('fee compensation', () => {
        let vault3;
        let vault4;
        let token3;
        let token4;
        let amount3;
        let amount4;
        beforeEach(async () => {
          for (let i in Object.keys(tokens)) {
            const vault = tokens[i];
            await vault.setMin(9990);

            await vault.earn();

            const vaultController = await MockYearnVaultController.at(await vault.controller());
            await vaultController.setWithdrawRatio(5, 10);
          }

          vault3 = balancerTokens[3];
          vault4 = balancerTokens[4];
          token3 = crvTokens[3];
          token4 = crvTokens[4];
          amount3 = ether('56438.206081079793598276');
          amount4 = ether('33337.281816828744424193');
        })

        it('should allow full fee compensation', async () => {
          await weightStrategy.mockPoke();

          // values before
          let res = await weightStrategy.getFeesToRefund();
          assert.equal(res.length, 2);
          assert.equal(res[0].vaultToken, vault4.address);
          assert.equal(res[0].crvToken, token4.address);
          assert.equal(res[0].crvAmount, amount4);

          assert.equal(res[1].vaultToken, vault3.address);
          assert.equal(res[1].crvToken, token3.address);
          assert.equal(res[1].crvAmount, amount3);

          await token3.transfer(alice, amount3);
          await token4.transfer(alice, amount4);

          // add some dust
          await token3.transfer(weightStrategy.address, '300');
          await token4.transfer(weightStrategy.address, '300');
          await vault3.transfer(weightStrategy.address, '500');
          await vault4.transfer(weightStrategy.address, '500');

          await token3.approve(weightStrategy.address, amount3, { from: alice });
          await token4.approve(weightStrategy.address, amount4, { from: alice });

          res = await weightStrategy.refundFees(
            alice,
            [balancerTokens[3].address, balancerTokens[4].address],
            [amount3, amount4],
            { from: alice },
          );
          expectEvent(res, 'RefundFees', {
            vaultToken: vault3.address,
            crvToken: token3.address,
            from: alice,
            crvAmount: amount3,
            vaultAmount: ether('56361.562892183477021648')
          });
          expectEvent(res, 'RefundFees', {
            vaultToken: vault4.address,
            crvToken: token4.address,
            from: alice,
            crvAmount: amount4,
            vaultAmount: ether('33269.267207638547388559')
          });

          // values after
          res = await weightStrategy.getFeesToRefund();
          assert.equal(res.length, 2);
          assert.equal(res[0].vaultToken, vault4.address);
          assert.equal(res[0].crvToken, token4.address);
          assert.equal(res[0].crvAmount, '0');

          assert.equal(res[1].vaultToken, vault3.address);
          assert.equal(res[1].crvToken, token3.address);
          assert.equal(res[1].crvAmount, '0');
        });

        it('should allow partial fee compensation', async () => {
          await weightStrategy.mockPoke();

          amount3 = (BigInt(ether('56438.206081079793598276')) - 1000n).toString();
          amount4 = (BigInt(ether('33337.281816828744424193')) - 1000n).toString();
          await token3.approve(weightStrategy.address, amount3, { from: alice });
          await token4.approve(weightStrategy.address, amount4, { from: alice });
          await token3.transfer(alice, amount3);
          await token4.transfer(alice, amount4);

          assert.equal(await pool.getBalance(vault3.address), ether('902398.168770198670643499'));
          assert.equal(await pool.getBalance(vault4.address), ether('355041.805924512364322665'));
          await weightStrategy.refundFees(
            alice,
            [vault3.address, vault4.address],
            [amount3, amount4],
            { from: alice },
          );
          assert.equal(await pool.getBalance(vault3.address), ether('958759.731662382147664148'));
          assert.equal(await pool.getBalance(vault4.address), ether('388311.073132150911710226'));

          const res = await weightStrategy.getFeesToRefund();
          assert.equal(res.length, 2);
          assert.equal(res[0].vaultToken, vault4.address);
          assert.equal(res[0].crvToken, token4.address);
          assert.equal(res[0].crvAmount, '1000');

          assert.equal(res[1].vaultToken, vault3.address);
          assert.equal(res[1].crvToken, token3.address);
          assert.equal(res[1].crvAmount, '1000');
        });

        it('should allow increment fees between pokes', async () => {
          // 1st poke
          await weightStrategy.mockPoke();
          let res = await weightStrategy.getFeesToRefund();
          assert.equal(res.length, 2);
          assert.equal(res[0].vaultToken, vault4.address);
          assert.equal(res[0].crvToken, token4.address);
          assert.equal(res[0].crvAmount, amount4);

          assert.equal(res[1].vaultToken, vault3.address);
          assert.equal(res[1].crvToken, token3.address);
          assert.equal(res[1].crvAmount, amount3);

          // 2nd poke (already imbalanced due the vault high fees)
          await time.increase(pokePeriod + 1);
          await weightStrategy.mockPoke();

          res = await weightStrategy.getFeesToRefund();
          assert.equal(res.length, 2);
          assert.equal(res[0].vaultToken, vault4.address);
          assert.equal(res[0].crvToken, token4.address);
          assert.equal(res[0].crvAmount, ether('37836.388626269312645498'));

          assert.equal(res[1].vaultToken, vault3.address);
          assert.equal(res[1].crvToken, token3.address);
          assert.equal(res[1].crvAmount, ether('67565.606276522799369245'));
        });
      });
    });
  });
});
