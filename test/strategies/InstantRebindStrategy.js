const fs = require('fs');
const _ = require('lodash');

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
const MockCurveDepositor2 = artifacts.require('MockCurveDepositor2');
const MockCurveDepositor3 = artifacts.require('MockCurveDepositor3');
const MockCurveDepositor4 = artifacts.require('MockCurveDepositor4');
const MockCurvePoolRegistry = artifacts.require('MockCurvePoolRegistry');
const MockYearnStrategy = artifacts.require('MockYearnStrategy');
const { deployProxied, gwei, artifactFromBytecode, mulScalarBN } = require('../helpers');

const YVaultV2 = artifactFromBytecode('yearn/YVaultV2');

WETH.numberFormat = 'String';
MockERC20.numberFormat = 'String';
PowerIndexPool.numberFormat = 'String';
PowerPoke.numberFormat = 'String';
MockCurveDepositor2.numberFormat = 'String';
MockCurveDepositor3.numberFormat = 'String';
MockCurveDepositor4.numberFormat = 'String';
MockCurvePoolRegistry.numberFormat = 'String';
MockYearnStrategy.numberFormat = 'String';
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
      const crv = await MockERC20.new('TKN', 'TKN', 18, ether(1e16));
      vault = await YVaultV2.new();
      await vault.initialize(
        // token
        crv.address,
        // governance
        stub,
        // rewards
        stub,
        // nameOverride
        '',
        // symbolOverride
        '',
        // guardian
        stub,
      );
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
          1,
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
        const vault2 = await YVaultV2.new();
        await vault2.initialize(crv2.address, stub, stub, '', '', stub);

        const crv3 = await MockERC20.new('TKN3', 'TKN3', 18, ether(1e16));
        const vault3 = await YVaultV2.new();
        await vault3.initialize(crv3.address, stub, stub, '', '', stub);

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
    let curvePoolRegistry;
    let depositors;
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

      this.createVaultToken = async (vaultItem, depositors, curvePoolRegistry) => {
        const crvToken = await MockERC20.new(vaultItem.name, 'CRV', 18, ether(1e16));
        crvTokens.push(crvToken);
        const crvDepositor = await depositors[vaultItem.config.amountsLength].new(
          crvToken.address,
          usdc.address,
          vaultItem.config.usdcIndex,
          BigInt(vaultItem.curvePool.virtualPrice),
        );
        const ycrvVault = await YVaultV2.new();
        await ycrvVault.initialize(
          // token
          crvToken.address,
          // governance
          stub,
          // rewards
          stub,
          // nameOverride
          '',
          // symbolOverride
          '',
          // guardian
          stub,
        );
        await ycrvVault.setDepositLimit('1000000000000000000000000000', { from: stub });
        await ycrvVault.setManagementFee('0', { from: stub });

        await curvePoolRegistry.set_virtual_price(crvToken.address, vaultItem.curvePool.virtualPrice);

        await crvToken.approve(ycrvVault.address, vaultItem.yearnVault.totalSupply);
        await ycrvVault.deposit(vaultItem.yearnVault.totalSupply);

        await usdc.transfer(crvDepositor.address, mwei(1e12));

        return {ycrvVault, crvDepositor};
      }
    });

    describe('Weights updating', () => {
      beforeEach(async () => {
        crvTokens = [];
        crvDepositors = [];
        weightStrategy = null;
        usdc = await MockERC20.new('USDC', 'USDC', 6, mwei(1e16));

        curvePoolRegistry = await MockCurvePoolRegistry.new();
        depositors = [null, null, MockCurveDepositor2, MockCurveDepositor3, MockCurveDepositor4];
        const denormWeights = [];

        for (let i = 0; i < vaultsData.length; i++) {
          const {ycrvVault, crvDepositor} = await this.createVaultToken(vaultsData[i], depositors, curvePoolRegistry);

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
            1,
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
            vaultsData[i].config.depositorType || 1,
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
            usdcPulled: mwei('259758.195298'),
            usdcRemainder: '1',
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
            usdcPulled: mwei('259758.195298'),
            usdcRemainder: '1',
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
            usdcPulled: mwei('259758.195298'),
            usdcRemainder: '1',
          });

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          const pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('83064.569772724530052331'));
          assert.equal(pull0.crvAmountExpected, ether('83064.569772724530052331'));
          assert.equal(pull0.crvAmountActual, ether('83064.569772724530052331'));
          assert.equal(pull0.usdcAmount, mwei('91060.294731'));
          assert.equal(pull0.vaultReserve, ether('16389957.259759308131042340'));

          const pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('154533.983508466302418755'));
          assert.equal(pull1.crvAmountExpected, ether('154533.983508466302418755'));
          assert.equal(pull1.crvAmountActual, ether('154533.983508466302418755'));
          assert.equal(pull1.usdcAmount, mwei('168697.900567'));
          assert.equal(pull1.vaultReserve, ether('41657837.378850978367377285'));

          const push0 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[0].address);
          assert.equal(push0.crvToken, crvTokens[0].address);
          assert.equal(push0.vaultAmount, ether('194458.636524754934445336'));
          assert.equal(push0.crvAmount, ether('194458.636524754934445336'));
          assert.equal(push0.usdcAmount, mwei('207142.311744'));

          const push1 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[2].address);
          assert.equal(push1.crvToken, crvTokens[2].address);
          assert.equal(push1.vaultAmount, ether('38059.603984278481776247'));
          assert.equal(push1.crvAmount, ether('38059.603984278481776247'));
          assert.equal(push1.usdcAmount, mwei('38633.015560'));

          const push2 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[1].address);
          assert.equal(push2.crvToken, crvTokens[1].address);
          assert.equal(push2.vaultAmount, ether('13779.290784920688065716'));
          assert.equal(push2.crvAmount, ether('13779.290784920688065716'));
          assert.equal(push2.usdcAmount, mwei('13982.867993'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.132370679337861024'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.373088863460271325'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.181946865339872727'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.224065128438652867'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.088528463423342056'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('3.309266983446525600'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.327221586506783125'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.548671633496818175'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.601628210966321675'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.213211585583551400'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('24.999999999999999975'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('546336.171210285143013899'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1616414.109583922713764931'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('788061.250223962626874946'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('902398.434802742933788673'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('355041.757045204631249762'));
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
          let res = await weightStrategy.mockPoke();

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('259758.195298'),
            usdcRemainder: '1',
          });

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          let pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('83064.569772724530052331'));
          assert.equal(pull0.crvAmountExpected, ether('83064.569772724530052331'));
          assert.equal(pull0.crvAmountActual, ether('83064.569772724530052331'));
          assert.equal(pull0.usdcAmount, mwei('91060.294731'));
          assert.equal(pull0.vaultReserve, ether('16389957.259759308131042340'));

          let pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('154533.983508466302418755'));
          assert.equal(pull1.crvAmountExpected, ether('154533.983508466302418755'));
          assert.equal(pull1.crvAmountActual, ether('154533.983508466302418755'));
          assert.equal(pull1.usdcAmount, mwei('168697.900567'));
          assert.equal(pull1.vaultReserve, ether('41657837.378850978367377285'));

          let push0 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[0].address);
          assert.equal(push0.crvToken, crvTokens[0].address);
          assert.equal(push0.vaultAmount, ether('194458.636524754934445336'));
          assert.equal(push0.crvAmount, ether('194458.636524754934445336'));
          assert.equal(push0.usdcAmount, mwei('207142.311744'));

          let push1 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[2].address);
          assert.equal(push1.crvToken, crvTokens[2].address);
          assert.equal(push1.vaultAmount, ether('38059.603984278481776247'));
          assert.equal(push1.crvAmount, ether('38059.603984278481776247'));
          assert.equal(push1.usdcAmount, mwei('38633.015560'));

          let push2 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[1].address);
          assert.equal(push2.crvToken, crvTokens[1].address);
          assert.equal(push2.vaultAmount, ether('13779.290784920688065716'));
          assert.equal(push2.crvAmount, ether('13779.290784920688065716'));
          assert.equal(push2.usdcAmount, mwei('13982.867993'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.132370679337861024'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.373088863460271325'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.181946865339872727'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.224065128438652867'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.088528463423342056'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('3.309266983446525600'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.327221586506783125'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.548671633496818175'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.601628210966321675'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.213211585583551400'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('24.999999999999999975'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('546336.171210285143013899'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1616414.109583922713764931'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('788061.250223962626874946'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('902398.434802742933788673'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('355041.757045204631249762'));

          await curvePoolRegistry.set_virtual_price(crvTokens[0].address, mulScalarBN(vaultsData[0].curvePool.virtualPrice, ether(1.05)));

          res = await weightStrategy.mockPoke();

          let update1 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'UpdatePoolTokenValue');
          assert.equal(update1.token, balancerTokens[0].address);
          assert.equal(update1.oldTokenValue, ether('26865809.076845363062913167'));
          assert.equal(update1.newTokenValue, ether('28426598.958018831203351211'));
          assert.equal(update1.lastChangeRate, ether('1'));
          assert.equal(update1.newChangeRate, ether('1.058095770602295191'));

          let update2 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'UpdatePoolTokenValue');
          assert.equal(update2.token, balancerTokens[1].address);
          assert.equal(update2.oldTokenValue, ether('75721709.857191736779949860'));
          assert.equal(update2.newTokenValue, ether('75735692.725184736779949860'));
          assert.equal(update2.lastChangeRate, ether('1'));
          assert.equal(update2.newChangeRate, ether('1.000184661281676961'));

          let update3 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'UpdatePoolTokenValue');
          assert.equal(update3.token, balancerTokens[2].address);
          assert.equal(update3.oldTokenValue, ether('36927737.855564451451360374'));
          assert.equal(update3.newTokenValue, ether('36966370.871124451451360374'));
          assert.equal(update3.lastChangeRate, ether('1'));
          assert.equal(update3.newChangeRate, ether('1.001046178775182639'));

          let update4 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'UpdatePoolTokenValue');
          assert.equal(update4.token, balancerTokens[3].address);
          assert.equal(update4.oldTokenValue, ether('45476014.715064726389354329'));
          assert.equal(update4.newTokenValue, ether('45307316.814496888010131378'));
          assert.equal(update4.lastChangeRate, ether('1'));
          assert.equal(update4.newChangeRate, ether('0.996290398320414954'));

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[1].address);
          assert.equal(pull0.crvToken, crvTokens[1].address);
          assert.equal(pull0.vaultAmount, ether('10843.888950330903577627'));
          assert.equal(pull0.crvAmountExpected, ether('10843.888950330903577627'));
          assert.equal(pull0.crvAmountActual, ether('10843.888950330903577627'));
          assert.equal(pull0.usdcAmount, mwei('11004.098112'));
          assert.equal(pull0.vaultReserve, ether('74633053.346434666341363789'));

          pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('13020.163449526250076359'));
          assert.equal(pull1.crvAmountExpected, ether('13020.163449526250076359'));
          assert.equal(pull1.crvAmountActual, ether('13020.163449526250076359'));
          assert.equal(pull1.usdcAmount, mwei('14213.535360'));
          assert.equal(pull1.vaultReserve, ether('41503303.395342512064958530'));

          let pull2 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PullLiquidity');
          assert.equal(pull2.vaultToken, balancerTokens[2].address);
          assert.equal(pull2.crvToken, crvTokens[2].address);
          assert.equal(pull2.vaultAmount, ether('3937.714635155849738554'));
          assert.equal(pull2.crvAmountExpected, ether('3937.714635155849738554'));
          assert.equal(pull2.crvAmountActual, ether('3937.714635155849738554'));
          assert.equal(pull2.usdcAmount, mwei('3997.040821'));
          assert.equal(pull2.vaultReserve, ether('36417696.514161634439069642'));

          let pull3 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PullLiquidity');
          assert.equal(pull3.vaultToken, balancerTokens[4].address);
          assert.equal(pull3.crvToken, crvTokens[4].address);
          assert.equal(pull3.vaultAmount, ether('6076.243207512054994412'));
          assert.equal(pull3.crvAmountExpected, ether('6076.243207512054994412'));
          assert.equal(pull3.crvAmountActual, ether('6076.243207512054994412'));
          assert.equal(pull3.usdcAmount, mwei('6661.137219'));
          assert.equal(pull3.vaultReserve, ether('16306892.689986583600990009'));

          push0 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[0].address);
          assert.equal(push0.crvToken, crvTokens[0].address);
          assert.equal(push0.vaultAmount, ether('33679.074701352799954380'));
          assert.equal(push0.crvAmount, ether('33679.074701352799954380'));
          assert.equal(push0.usdcAmount, mwei('35875.811513'));

          assert.equal(await weightStrategy.valueChangeRate(balancerTokens[0].address), ether('1.058095770602295191'));
          assert.equal(await weightStrategy.valueChangeRate(balancerTokens[1].address), ether('1.000184661281676961'));
          assert.equal(await weightStrategy.valueChangeRate(balancerTokens[2].address), ether('1.001046178775182639'));
          assert.equal(await weightStrategy.valueChangeRate(balancerTokens[3].address), ether('0.996290398320414954'));

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.146181738985618425'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.368149347490272280'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.179847403215930240'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.219380252018066665'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.086441258290112390'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('3.654543474640460625'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.203733687256807000'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.496185080398256000'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.484506300451666625'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.161031457252809750'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('25'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('580015.245911637942968279'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1605570.220633591810187304'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('784123.535588806777136392'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('889378.271353216683712314'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('348965.513837692576255350'));

          await time.increase(pokePeriod * 2);

          res = await weightStrategy.mockPoke();
          update1 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'UpdatePoolTokenValue');
          assert.equal(update1.token, balancerTokens[0].address);
          assert.equal(update1.oldTokenValue, ether('28426598.958018831203351211'));
          assert.equal(update1.newTokenValue, ether('28464268.560107481203334371'));
          assert.equal(update1.lastChangeRate, ether('1.058095770602295191'));
          assert.equal(update1.newChangeRate, ether('1.059497909729425221'));

          update2 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'UpdatePoolTokenValue');
          assert.equal(update2.token, balancerTokens[1].address);
          assert.equal(update2.oldTokenValue, ether('75735692.725184736779949860'));
          assert.equal(update2.newTokenValue, ether('75724688.627071852582281718'));
          assert.equal(update2.lastChangeRate, ether('1.000184661281676961'));
          assert.equal(update2.newChangeRate, ether('1.000039338386385274'));

          update3 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'UpdatePoolTokenValue');
          assert.equal(update3.token, balancerTokens[2].address);
          assert.equal(update3.oldTokenValue, ether('36966370.871124451451360374'));
          assert.equal(update3.newTokenValue, ether('36962373.830303068884792182'));
          assert.equal(update3.lastChangeRate, ether('1.001046178775182639'));
          assert.equal(update3.newChangeRate, ether('1.000937939249733878'));

          update4 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'UpdatePoolTokenValue');
          assert.equal(update4.token, balancerTokens[3].address);
          assert.equal(update4.oldTokenValue, ether('45307316.814496888010131378'));
          assert.equal(update4.newTokenValue, ether('45293103.279136461306290197'));
          assert.equal(update4.lastChangeRate, ether('0.996290398320414954'));
          assert.equal(update4.newChangeRate, ether('0.995977848167340124'));

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[3].address);
          assert.equal(pull0.crvToken, crvTokens[3].address);
          assert.equal(pull0.vaultAmount, ether('233.054906370147755631'));
          assert.equal(pull0.crvAmountExpected, ether('233.054906370147755631'));
          assert.equal(pull0.crvAmountActual, ether('233.054906370147755631'));
          assert.equal(pull0.usdcAmount, mwei('254.415711'));
          assert.equal(pull0.vaultReserve, ether('41490283.231892985814882171'));

          pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[4].address);
          assert.equal(pull1.crvToken, crvTokens[4].address);
          assert.equal(pull1.vaultAmount, ether('132.555766775648645799'));
          assert.equal(pull1.crvAmountExpected, ether('132.555766775648645799'));
          assert.equal(pull1.crvAmountActual, ether('132.555766775648645799'));
          assert.equal(pull1.usdcAmount, mwei('145.315472'));
          assert.equal(pull1.vaultReserve, ether('16300816.446779071545995597'));

          push0 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[1].address);
          assert.equal(push0.crvToken, crvTokens[1].address);
          assert.equal(push0.vaultAmount, ether('120.159217575280712053'));
          assert.equal(push0.crvAmount, ether('120.159217575280712053'));
          assert.equal(push0.usdcAmount, mwei('121.934467'));

          push1 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[2].address);
          assert.equal(push1.crvToken, crvTokens[2].address);
          assert.equal(push1.vaultAmount, ether('116.988121798664659789'));
          assert.equal(push1.crvAmount, ether('116.988121798664659789'));
          assert.equal(push1.usdcAmount, mwei('118.750682'));

          push2 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[0].address);
          assert.equal(push2.crvToken, crvTokens[0].address);
          assert.equal(push2.vaultAmount, ether('149.307373597409831637'));
          assert.equal(push2.crvAmount, ether('149.307373597409831637'));
          assert.equal(push2.usdcAmount, mwei('159.046032'));

          assert.equal(await weightStrategy.valueChangeRate(balancerTokens[0].address), ether('1.059497909729425221'));
          assert.equal(await weightStrategy.valueChangeRate(balancerTokens[1].address), ether('1.000039338386385274'));
          assert.equal(await weightStrategy.valueChangeRate(balancerTokens[2].address), ether('1.000937939249733878'));
          assert.equal(await weightStrategy.valueChangeRate(balancerTokens[3].address), ether('0.995977848167340124'));

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.146563590593950441'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.368027730737009159'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.179801358809503463'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.219233905377780503'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.086373414481756434'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('3.664089764848761025'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.200693268425228975'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.495033970237586575'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.480847634444512575'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.159335362043910850'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('25'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('580164.553285235352799916'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1605690.379851167090899357'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('784240.523710605441796181'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('889145.216446846535956683'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('348832.958070916927609551'));
        });

        it('should correctly rebalance token balances with insufficient underlying tokens on vault', async () => {
          for (let i in Object.keys(tokens)) {
            const vault = tokens[i];

            // https://etherscan.io/address/0xB3E1a513a2fE74EcF397dF9C0E6BCe5B57A961C8
            const yearnVaultStrategy = await MockYearnStrategy.new(vault.address);
            await yearnVaultStrategy.setWithdrawalLossRate(5, 10);
            await vault.addStrategy(
              yearnVaultStrategy.address,
              // debtRatio
              9990,
              // minDebtPerHarvest
              0,
              // maxDebtPerHarvest
              constants.MAX_UINT256,
              // performanceFee
              1000,
              { from: stub },
            );
            await yearnVaultStrategy.harvest();
          }

          // 50%
          await weightStrategy.setMaxWithdrawalLoss(5000);

          assert.equal(await crvTokens[3].balanceOf(weightStrategy.address), '0');
          let res = await weightStrategy.mockPoke();

          // leftovers
          for (let i in Object.keys(tokens)) {
            assert.equal(await balancerTokens[i].balanceOf(weightStrategy.address), '0');
            assert.equal(await crvTokens[0].balanceOf(weightStrategy.address), '0');
          }

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('161600.925321'),
            usdcRemainder: '2',
          });

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          const pull0 = res.logs[0].args; //++
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('83064.569772724530052331'));
          assert.equal(pull0.crvAmountExpected, ether('83064.569772724530052331'));
          assert.equal(pull0.crvAmountActual, ether('49727.263516241919091687'));
          assert.equal(pull0.usdcAmount, mwei('54513.967680'));
          assert.equal(pull0.vaultReserve, ether('16389.957259759308131043'));

          const pull1 = res.logs[1].args; // ++
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('154533.983508466302418755'));
          assert.equal(pull1.crvAmountExpected, ether('154533.983508466302418755'));
          assert.equal(pull1.crvAmountActual, ether('98095.910443658640393066'));
          assert.equal(pull1.usdcAmount, mwei('107086.957641'));
          assert.equal(pull1.vaultReserve, ether('41657.837378850978367378'));

          const push0 = res.logs[2].args; //++
          assert.equal(res.logs[2].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[0].address);
          assert.equal(push0.crvToken, crvTokens[0].address);
          assert.equal(push0.vaultAmount, ether('120976.724384202398736612'));
          assert.equal(push0.crvAmount, ether('120976.724384202398736612'));
          assert.equal(push0.usdcAmount, mwei('128867.500071'));

          const push1 = res.logs[3].args; //++
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[2].address);
          assert.equal(push1.crvToken, crvTokens[2].address);
          assert.equal(push1.vaultAmount, ether('23677.663813253595715373'));
          assert.equal(push1.crvAmount, ether('23677.663813253595715373'));
          assert.equal(push1.usdcAmount, mwei('24034.394969'));

          const push2 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[1].address);
          assert.equal(push2.crvToken, crvTokens[1].address);
          assert.equal(push2.vaultAmount, ether('8572.380703384842581713'));
          assert.equal(push2.crvAmount, ether('8572.380703384842581713'));
          assert.equal(push2.usdcAmount, mwei('8699.030279'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.132370679337861024'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.373088863460271325'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.181946865339872727'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.224065128438652867'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.088528463423342056'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('3.309266983446525600'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.327221586506783125'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.548671633496818175'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.601628210966321675'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.213211585583551400'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('24.999999999999999975'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('472854.259069732607305175'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1611207.199502386868280928'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('773679.310052937740814072'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('902398.434802742933788673'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('355041.757045204631249762'));
        });
      });

      describe('changePoolTokens', () => {
        it('should correctly replace one token with new', async () => {
          const {ycrvVault, crvDepositor} = await this.createVaultToken(vaultsData[0], depositors, curvePoolRegistry);
          await weightStrategy.setVaultConfig(
            ycrvVault.address,
            crvDepositor.address,
            vaultsData[0].config.depositorType || 1,
            vaultsData[0].config.amountsLength,
            vaultsData[0].config.usdcIndex,
          );

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('351877.534685530208568563')); // Compound
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1602634.818799002025699215')); // 3CRV
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('750001.646239684145098699')); // GUSD
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('1056932.418311209236207428')); // Y
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('438106.326817929161302093')); // BUSD

          const tokensToChange = balancerTokens.map(t => t.address).slice(1).concat([ycrvVault.address]);
          // ACTION
          const res = await weightStrategy.changePoolTokens(tokensToChange);

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('634587.142410'),
            usdcRemainder: '1',
          });

          assert.equal(await weightStrategy.valueChangeRate(ycrvVault.address), ether(1));

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          let pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('83064.569772779045146663'));
          assert.equal(pull0.crvAmountExpected, ether('83064.569772779045146663'));
          assert.equal(pull0.crvAmountActual, ether('83064.569772779045146663'));
          assert.equal(pull0.usdcAmount, mwei('91060.294731'));
          assert.equal(pull0.vaultReserve, ether('16389957.259759308131042340'));

          let pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('154533.983508604861714448'));
          assert.equal(pull1.crvAmountExpected, ether('154533.983508604861714448'));
          assert.equal(pull1.crvAmountActual, ether('154533.983508604861714448'));
          assert.equal(pull1.usdcAmount, mwei('168697.900567'));
          assert.equal(pull1.vaultReserve, ether('41657837.378850978367377285'));

          let push0 = res.logs[2].args;
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[2].address);
          assert.equal(push0.crvToken, crvTokens[2].address);
          assert.equal(push0.vaultAmount, ether('38059.603984278481776247'));
          assert.equal(push0.crvAmount, ether('38059.603984278481776247'));
          assert.equal(push0.usdcAmount, mwei('38633.015560'));

          let push1 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, ycrvVault.address);
          assert.equal(push1.crvToken, await ycrvVault.token());
          assert.equal(push1.vaultAmount, ether('546336.171210590179530708'));
          assert.equal(push1.crvAmount, ether('546336.171210590179530708'));
          assert.equal(push1.usdcAmount, mwei('581971.258857'));

          let push2 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[1].address);
          assert.equal(push2.crvToken, crvTokens[1].address);
          assert.equal(push2.vaultAmount, ether('13779.290783935247110984'));
          assert.equal(push2.crvAmount, ether('13779.290783935247110984'));
          assert.equal(push2.usdcAmount, mwei('13982.867992'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(ycrvVault.address), ether('0.132370679337861024'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.373088863460271325'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.181946865339872727'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.224065128438652867'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.088528463423342056'));

          assert.equal(await pool.getDenormalizedWeight(ycrvVault.address), ether('3.309266983446525600'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.327221586506783125'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.548671633496818175'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.601628210966321675'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.213211585583551400'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('24.999999999999999975'));

          assert.equal(await pool.getBalance(ycrvVault.address), ether('546336.171210590179530708'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1616414.109582937272810199'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('788061.250223962626874946'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('902398.434802604374492980'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('355041.757045150116155430'));
        });

        it('should correctly replace one token with new with higher price', async () => {
          const vaultItem = _.cloneDeep(vaultsData[0]);
          vaultItem.curvePool.virtualPrice = mulScalarBN(vaultItem.curvePool.virtualPrice, ether(1.05));

          const {ycrvVault, crvDepositor} = await this.createVaultToken(vaultItem, depositors, curvePoolRegistry);
          await weightStrategy.setVaultConfig(
            ycrvVault.address,
            crvDepositor.address,
            vaultItem.config.depositorType || 1,
            vaultItem.config.amountsLength,
            vaultItem.config.usdcIndex,
          );

          await weightStrategy.setStrategyConstraints(
            {
              minUSDCRemainder: 42,
              useVirtualPriceEstimation: true,
            },
            { from: minter },
          );

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('351877.534685530208568563')); // Compound
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1602634.818799002025699215')); // 3CRV
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('750001.646239684145098699')); // GUSD
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('1056932.418311209236207428')); // Y
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('438106.326817929161302093')); // BUSD

          const tokensToChange = balancerTokens.map(t => t.address).slice(1).concat([ycrvVault.address]);
          let res = await weightStrategy.setValueChangeRates([ycrvVault.address], [ether(1.05)]);
          expectEvent(res, 'SetValueChangeRate', {
            token: ycrvVault.address,
            oldRate: '0',
            newRate: ether(1.05),
          });
          assert.equal(await weightStrategy.valueChangeRate(ycrvVault.address), ether(1.05));
          // ACTION
          res = await weightStrategy.changePoolTokens(tokensToChange);

          expectEvent(res, 'ChangePoolTokens', {
            poolTokensBefore: balancerTokens.map(t => t.address),
            poolTokensAfter: tokensToChange
          });

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '5',
            usdcPulled: mwei('660959.107136'),
            usdcRemainder: '1',
          });

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          const pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('87817.289550122889370686'));
          assert.equal(pull0.crvAmountExpected, ether('87817.289550122889370686'));
          assert.equal(pull0.crvAmountActual, ether('87817.289550122889370686'));
          assert.equal(pull0.usdcAmount, mwei('96270.507278'));
          assert.equal(pull0.vaultReserve, ether('16389957.259759308131042340'));

          const pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[3].address);
          assert.equal(pull1.crvToken, crvTokens[3].address);
          assert.equal(pull1.vaultAmount, ether('166613.821451681127844353'));
          assert.equal(pull1.crvAmountExpected, ether('166613.821451681127844353'));
          assert.equal(pull1.crvAmountActual, ether('166613.821451681127844353'));
          assert.equal(pull1.usdcAmount, mwei('181884.924249'));
          assert.equal(pull1.vaultReserve, ether('41657837.378850978367377285'));

          const push0 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PullLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[1].address);
          assert.equal(push0.crvToken, crvTokens[1].address);
          assert.equal(push0.vaultAmount, ether('7858.624064739913548021'));
          assert.equal(push0.crvAmountExpected, ether('7858.624064739913548021'));
          assert.equal(push0.crvAmountActual, ether('7858.624064739913548021'));
          assert.equal(push0.usdcAmount, mwei('7974.728497'));
          assert.equal(push0.vaultReserve, ether('74619274.055649745653298073'));

          const push2 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, balancerTokens[2].address);
          assert.equal(push2.crvToken, crvTokens[2].address);
          assert.equal(push2.vaultAmount, ether('27510.325722798716021220'));
          assert.equal(push2.crvAmount, ether('27510.325722798716021220'));
          assert.equal(push2.usdcAmount, mwei('27924.800325'));

          const push3 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push3.vaultToken, ycrvVault.address);
          assert.equal(push3.crvToken, await ycrvVault.token());
          assert.equal(push3.vaultAmount, ether('565973.849614856449227883'));
          assert.equal(push3.crvAmount, ether('565973.849614856449227883'));
          assert.equal(push3.usdcAmount, mwei('633034.306810'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(ycrvVault.address), ether('0.143985085108137677'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.368094558466876209'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.179511257560879671'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.221065710071060543'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.0873433887930459'));

          assert.equal(await pool.getDenormalizedWeight(ycrvVault.address), ether('3.599627127703441925'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('9.202363961671905225'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.487781439021991775'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('5.526642751776513575'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('2.183584719826147500'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('25'));

          assert.equal(await pool.getBalance(ycrvVault.address), ether('565973.849614856449227883'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1594776.194734262112151194'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('777511.971962482861119919'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('890318.596859528108363075'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('350289.037267806271931407'));
        });

        it('should correctly add new token with new with same price', async () => {
          const vaultItem = _.cloneDeep(vaultsData[0]);

          const {ycrvVault, crvDepositor} = await this.createVaultToken(vaultItem, depositors, curvePoolRegistry);
          await weightStrategy.setVaultConfig(
            ycrvVault.address,
            crvDepositor.address,
            vaultItem.config.depositorType || 1,
            vaultItem.config.amountsLength,
            vaultItem.config.usdcIndex,
          );
          assert.equal(await weightStrategy.valueChangeRate(ycrvVault.address), '0');

          await weightStrategy.setStrategyConstraints(
            {
              minUSDCRemainder: 42,
              useVirtualPriceEstimation: true,
            },
            { from: minter },
          );

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('351877.534685530208568563')); // Compound
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1602634.818799002025699215')); // 3CRV
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('750001.646239684145098699')); // GUSD
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('1056932.418311209236207428')); // Y
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('438106.326817929161302093')); // BUSD

          assert.equal(await weightStrategy.lastValue(ycrvVault.address), '0');
          assert.equal(await weightStrategy.lastValue(balancerTokens[0].address), '0');
          assert.equal(await weightStrategy.lastValue(balancerTokens[1].address), '0');
          assert.equal(await weightStrategy.lastValue(balancerTokens[2].address), '0');
          assert.equal(await weightStrategy.lastValue(balancerTokens[3].address), '0');
          assert.equal(await weightStrategy.lastValue(balancerTokens[4].address), '0');

          const tokensToChange = balancerTokens.map(t => t.address).concat([ycrvVault.address]);
          // ACTION
          let res = await weightStrategy.changePoolTokens(tokensToChange);

          expectEvent(res, 'ChangePoolTokens', {
            poolTokensBefore: balancerTokens.map(t => t.address),
            poolTokensAfter: tokensToChange
          });

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '6',
            usdcPulled: mwei('653052.239632'),
            usdcRemainder: '1',
          });

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          const pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('124567.868498953023448797'));
          assert.equal(pull0.crvAmountExpected, ether('124567.868498953023448797'));
          assert.equal(pull0.crvAmountActual, ether('124567.868498953023448797'));
          assert.equal(pull0.usdcAmount, mwei('136558.665753'));
          assert.equal(pull0.vaultReserve, ether('16389957.259759308131042340'));

          const pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[2].address);
          assert.equal(pull1.crvToken, crvTokens[2].address);
          assert.equal(pull1.vaultAmount, ether('54062.353034435376760742'));
          assert.equal(pull1.crvAmountExpected, ether('54062.353034435376760742'));
          assert.equal(pull1.crvAmountActual, ether('54062.353034435376760742'));
          assert.equal(pull1.usdcAmount, mwei('54876.864374'));
          assert.equal(pull1.vaultReserve, ether('36379636.910177355957293395'));

          const pull2 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PullLiquidity');
          assert.equal(pull2.vaultToken, balancerTokens[3].address);
          assert.equal(pull2.crvToken, crvTokens[3].address);
          assert.equal(pull2.vaultAmount, ether('260021.608742730619318877'));
          assert.equal(pull2.crvAmountExpected, ether('260021.608742730619318877'));
          assert.equal(pull2.crvAmountActual, ether('260021.608742730619318877'));
          assert.equal(pull2.usdcAmount, mwei('283854.065631'));
          assert.equal(pull2.vaultReserve, ether('41657837.378850978367377285'));

          const push0 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PullLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[1].address);
          assert.equal(push0.crvToken, crvTokens[1].address);
          assert.equal(push0.vaultAmount, ether('175174.589495562503352690'));
          assert.equal(push0.crvAmountExpected, ether('175174.589495562503352690'));
          assert.equal(push0.crvAmountActual, ether('175174.589495562503352690'));
          assert.equal(pull1.vaultReserve, ether('36379636.910177355957293395'));

          const push1 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[0].address);
          assert.equal(push1.crvToken, crvTokens[0].address);
          assert.equal(push1.vaultAmount, ether('130593.604120174089919946'));
          assert.equal(push1.crvAmount, ether('130593.604120174089919946'));
          assert.equal(push1.usdcAmount, mwei('139111.646260'));

          const push2 = res.logs[5].args;
          assert.equal(res.logs[5].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, ycrvVault.address);
          assert.equal(push2.crvToken, await ycrvVault.token());
          assert.equal(push2.vaultAmount, ether('482471.138804131798398842'));
          assert.equal(push2.crvAmount, ether('482471.138804131798398842'));
          assert.equal(push2.usdcAmount, mwei('513940.593371'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.116896950577405494'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.329475913027375602'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.160677831614523773'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.197872598193439648'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.078179756009849990'));
          assert.equal(await pool.getNormalizedWeight(ycrvVault.address), ether('0.116896950577405494'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('2.922423764435137350'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('8.236897825684390050'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.016945790363094325'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('4.946814954835991200'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('1.954493900246249750'));
          assert.equal(await pool.getDenormalizedWeight(ycrvVault.address), ether('2.922423764435137350'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('25.000000000000000025'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('482471.138805704298488509'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1427460.229303439522346525'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('695939.293205248768337957'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('796910.809568478616888551'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('313538.458318976137853296'));
          assert.equal(await pool.getBalance(ycrvVault.address), ether('482471.138804131798398842'));
        });

        it('should correctly remove token', async () => {
          const vaultItem = _.cloneDeep(vaultsData[0]);

          const {ycrvVault, crvDepositor} = await this.createVaultToken(vaultItem, depositors, curvePoolRegistry);
          await weightStrategy.setVaultConfig(
            ycrvVault.address,
            crvDepositor.address,
            vaultItem.config.depositorType || 1,
            vaultItem.config.amountsLength,
            vaultItem.config.usdcIndex,
          );

          await weightStrategy.setStrategyConstraints(
            {
              minUSDCRemainder: 42,
              useVirtualPriceEstimation: true,
            },
            { from: minter },
          );

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('351877.534685530208568563')); // Compound
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1602634.818799002025699215')); // 3CRV
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('750001.646239684145098699')); // GUSD
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('1056932.418311209236207428')); // Y
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('438106.326817929161302093')); // BUSD

          const tokensToChange = balancerTokens.map(t => t.address).concat([ycrvVault.address]);
          // ACTION
          let res = await weightStrategy.changePoolTokens(tokensToChange);

          expectEvent(res, 'ChangePoolTokens', {
            poolTokensBefore: balancerTokens.map(t => t.address),
            poolTokensAfter: tokensToChange
          });

          expectEvent(res, 'InstantRebind', {
            poolCurrentTokensCount: '6',
            usdcPulled: mwei('653052.239632'),
            usdcRemainder: '1',
          });

          res.logs = res.logs.filter(l => l.event !== 'UpdatePoolTokenValue');

          const pull0 = res.logs[0].args;
          assert.equal(res.logs[0].event, 'PullLiquidity');
          assert.equal(pull0.vaultToken, balancerTokens[4].address);
          assert.equal(pull0.crvToken, crvTokens[4].address);
          assert.equal(pull0.vaultAmount, ether('124567.868498953023448797'));
          assert.equal(pull0.crvAmountExpected, ether('124567.868498953023448797'));
          assert.equal(pull0.crvAmountActual, ether('124567.868498953023448797'));
          assert.equal(pull0.usdcAmount, mwei('136558.665753'));
          assert.equal(pull0.vaultReserve, ether('16389957.259759308131042340'));

          const pull1 = res.logs[1].args;
          assert.equal(res.logs[1].event, 'PullLiquidity');
          assert.equal(pull1.vaultToken, balancerTokens[2].address);
          assert.equal(pull1.crvToken, crvTokens[2].address);
          assert.equal(pull1.vaultAmount, ether('54062.353034435376760742'));
          assert.equal(pull1.crvAmountExpected, ether('54062.353034435376760742'));
          assert.equal(pull1.crvAmountActual, ether('54062.353034435376760742'));
          assert.equal(pull1.usdcAmount, mwei('54876.864374'));
          assert.equal(pull1.vaultReserve, ether('36379636.910177355957293395'));

          const pull2 = res.logs[2].args;
          assert.equal(res.logs[2].event, 'PullLiquidity');
          assert.equal(pull2.vaultToken, balancerTokens[3].address);
          assert.equal(pull2.crvToken, crvTokens[3].address);
          assert.equal(pull2.vaultAmount, ether('260021.608742730619318877'));
          assert.equal(pull2.crvAmountExpected, ether('260021.608742730619318877'));
          assert.equal(pull2.crvAmountActual, ether('260021.608742730619318877'));
          assert.equal(pull2.usdcAmount, mwei('283854.065631'));
          assert.equal(pull2.vaultReserve, ether('41657837.378850978367377285'));

          const push0 = res.logs[3].args;
          assert.equal(res.logs[3].event, 'PullLiquidity');
          assert.equal(push0.vaultToken, balancerTokens[1].address);
          assert.equal(push0.crvToken, crvTokens[1].address);
          assert.equal(push0.vaultAmount, ether('175174.589495562503352690'));
          assert.equal(push0.crvAmountExpected, ether('175174.589495562503352690'));
          assert.equal(push0.crvAmountActual, ether('175174.589495562503352690'));
          assert.equal(push0.usdcAmount, mwei('177762.643874'));
          assert.equal(pull1.vaultReserve, ether('36379636.910177355957293395'));

          const push1 = res.logs[4].args;
          assert.equal(res.logs[4].event, 'PushLiquidity');
          assert.equal(push1.vaultToken, balancerTokens[0].address);
          assert.equal(push1.crvToken, crvTokens[0].address);
          assert.equal(push1.vaultAmount, ether('130593.604120174089919946'));
          assert.equal(push1.crvAmount, ether('130593.604120174089919946'));
          assert.equal(push1.usdcAmount, mwei('139111.646260'));

          const push2 = res.logs[5].args;
          assert.equal(res.logs[5].event, 'PushLiquidity');
          assert.equal(push2.vaultToken, ycrvVault.address);
          assert.equal(push2.crvToken, await ycrvVault.token());
          assert.equal(push2.vaultAmount, ether('482471.138804131798398842'));
          assert.equal(push2.crvAmount, ether('482471.138804131798398842'));
          assert.equal(push2.usdcAmount, mwei('513940.593371'));

          await time.increase(pokePeriod * 2);

          assert.equal(await pool.getNormalizedWeight(balancerTokens[0].address), ether('0.116896950577405494'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[1].address), ether('0.329475913027375602'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[2].address), ether('0.160677831614523773'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[3].address), ether('0.197872598193439648'));
          assert.equal(await pool.getNormalizedWeight(balancerTokens[4].address), ether('0.078179756009849990'));
          assert.equal(await pool.getNormalizedWeight(ycrvVault.address), ether('0.116896950577405494'));

          assert.equal(await pool.getDenormalizedWeight(balancerTokens[0].address), ether('2.922423764435137350'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[1].address), ether('8.236897825684390050'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[2].address), ether('4.016945790363094325'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[3].address), ether('4.946814954835991200'));
          assert.equal(await pool.getDenormalizedWeight(balancerTokens[4].address), ether('1.954493900246249750'));
          assert.equal(await pool.getDenormalizedWeight(ycrvVault.address), ether('2.922423764435137350'));
          assert.equal(await pool.getTotalDenormalizedWeight(), ether('25.000000000000000025'));

          assert.equal(await pool.getBalance(balancerTokens[0].address), ether('482471.138805704298488509'));
          assert.equal(await pool.getBalance(balancerTokens[1].address), ether('1427460.229303439522346525'));
          assert.equal(await pool.getBalance(balancerTokens[2].address), ether('695939.293205248768337957'));
          assert.equal(await pool.getBalance(balancerTokens[3].address), ether('796910.809568478616888551'));
          assert.equal(await pool.getBalance(balancerTokens[4].address), ether('313538.458318976137853296'));
          assert.equal(await pool.getBalance(ycrvVault.address), ether('482471.138804131798398842'));
        });
      });
    });
  });
});
