const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber } = require('../../helpers');
const { buildBasicRouterConfig, buildAlpacaRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const AlpacaRouter = artifacts.require('AlpacaRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockERC20 = artifacts.require('MockERC20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockGeneralMasterChef = artifacts.require('MockGeneralMasterChef');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const MockPoke = artifacts.require('MockPoke');

const FairLaunch = artifactFromBytecode('bsc/AlpacaFairLaunch');
const AlpacaVault = artifactFromBytecode('bsc/AlpacaVault');
const AlpacaToken = artifactFromBytecode('bsc/AlpacaToken');
const AlpacaTripleSlopeModel = artifactFromBytecode('bsc/AlpacaTripleSlopeModel');
const AlpacaConfigurableInterestVaultConfig = artifactFromBytecode('bsc/AlpacaConfigurableInterestVaultConfig');

AlpacaRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
MockERC20.numberFormat = 'String';

const { web3 } = WrappedPiErc20;

const REPORTER_ID = 42;

describe('Alpaca Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2, alpacaTreasury;

  before(async function() {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2, alpacaTreasury] = await web3.eth.getAccounts();
  });

  let alpaca, debtToken, ibALPACA, vaultConfig, fairLaunch, poolRestrictions, piAlpaca, alpacaRouter, poke;

  beforeEach(async function() {
    // bsc: 0xadcfbf2e8470493060fbe0a0afac66d2cb028e9c
    const tripleSlopeModel = await AlpacaTripleSlopeModel.new();

    // bsc: 0x8f0528ce5ef7b51152a59745befdd91d97091d2f
    let currentBlock = (await time.latestBlock()).toNumber();
    alpaca = await AlpacaToken.new(currentBlock - 1, currentBlock);

    // bsc: 0x11362ea137a799298306123eea014b7809a9db40 (impl: 0x036664394715d255895f600861fe882a167dbf57)
    debtToken = await MockERC20.new('AlpacaTokenDebt', 'ALPACADebt', 18, ether(10000000000));

    // bsc: 0xa625ab01b08ce023b2a342dbb12a16f2c8489a8f
    fairLaunch = await FairLaunch.new(
      alpaca.address,
      // devaddr
      deployer,
      // alpacaPerBlock
      ether(20),
      // startBlock
      await latestBlockNumber(),
      0,
      0,
    );

    // bsc: 0x8f8ed54901b90c89c5817b7f67a425c0e6091284 (impl: 0xc2f7c637702b9131cb58dcbf49a119b77d994ed3)
    vaultConfig = await AlpacaConfigurableInterestVaultConfig.new();
    await vaultConfig.initialize(
      // _minDebtSize
      ether(50),
      // _reservePoolBps
      1900,
      // _killBps
      100,
      // _interestModel
      tripleSlopeModel.address,
      // _getWrappedNativeAddr
      constants.ZERO_ADDRESS,
      // _getWNativeRelayer
      constants.ZERO_ADDRESS,
      // _getFairLaunchAddr
      fairLaunch.address,
      // _getKillTreasuryBps
      400,
      // _treasury
      alpacaTreasury,
    );

    // bsc: 0xf1be8ecc990cbcb90e166b71e368299f0116d421 (impl: 0xcc7830c29fa5fdf0e289562470672285290e3a20)
    ibALPACA = await AlpacaVault.new();
    await ibALPACA.initialize(
      // vaultConfig,
      vaultConfig.address,
      // token
      alpaca.address,
      // name
      'Interest Bearing ALPACA ',
      // symbol
      'ibALPACA',
      // decimals
      18,
      // debtToken
      debtToken.address,
    );

    poolRestrictions = await PoolRestrictions.new();
    piAlpaca = await WrappedPiErc20.new(alpaca.address, stub, 'Wrapped ALPACA', 'piALPACA');

    poke = await MockPoke.new(true);
    alpacaRouter = await AlpacaRouter.new(
      piAlpaca.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        fairLaunch.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
      buildAlpacaRouterConfig(alpaca.address, ibALPACA.address, 0),
    );

    await piAlpaca.changeRouter(alpacaRouter.address, { from: stub });
    await fairLaunch.addPool(350, ibALPACA.address, true);
    await alpacaRouter.transferOwnership(piGov);

    // setting up rewards
    await alpaca.approve(ibALPACA.address, ether(100));
    await ibALPACA.deposit(ether(100));
    await alpaca.transfer(ibALPACA.address, ether(100));
    await alpaca.transferOwnership(fairLaunch.address);

    assert.equal(await alpacaRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await alpacaRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await alpaca.transfer(alice, ether('10000'));
        await alpaca.approve(piAlpaca.address, ether('10000'), { from: alice });
        await piAlpaca.deposit(ether('10000'), { from: alice });
        assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(0));

        await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(2000));
        assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(4000));
        assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(4000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await alpacaRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(0));
          assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(5000));
          const userInfo = await fairLaunch.userInfo(0, piAlpaca.address);
          assert.equal(userInfo.amount, ether(5000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(alpacaRouter.stake(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await alpacaRouter.redeem(ether(3000), { from: piGov });
          expectEvent(res, 'Redeem', {
            sender: piGov,
            amount: ether(3000),
            ibAlpacaAmount: ether(1500),
            rewardReceived: ether(20),
          });
          assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(5000));
          assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(2500));
          assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(2500));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(alpacaRouter.redeem(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });
    });

    describe('setRewardPools()', () => {
      it('should allow the owner setting a new reward pool', async () => {
        const res = await alpacaRouter.setRewardPools([alice, bob], { from: piGov });
        expectEvent(res, 'SetRewardPools', {
          len: '2',
          rewardPools: [alice, bob],
        });
      });

      it('should deny setting an empty reward pool', async () => {
        await expectRevert(alpacaRouter.setRewardPools([], { from: piGov }), 'AT_LEAST_ONE_EXPECTED');
      });

      it('should deny non-owner setting a new reward pool', async () => {
        await expectRevert(
          alpacaRouter.setRewardPools([alice, bob], { from: alice }),
          'Ownable: caller is not the owner',
        );
      });
    });

    describe('setPvpFee()', () => {
      it('should allow the owner setting a new pvpFee', async () => {
        const res = await alpacaRouter.setPvpFee(ether('0.1'), { from: piGov });
        expectEvent(res, 'SetPvpFee', {
          pvpFee: ether('0.1'),
        });
      });

      it('should deny setting a fee greater or equal 100%', async () => {
        await expectRevert(alpacaRouter.setPvpFee(ether('1'), { from: piGov }), 'PVP_FEE_OVER_THE_LIMIT');
      });

      it('should deny non-owner setting a new pvpFee', async () => {
        await expectRevert(alpacaRouter.setPvpFee(ether('0'), { from: alice }), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      // alice
      await alpaca.transfer(alice, ether('20000'));
      await alpaca.approve(piAlpaca.address, ether('10000'), { from: alice });
      await piAlpaca.deposit(ether('10000'), { from: alice });

      // bob
      await alpaca.transfer(bob, ether('42000'));

      await alpaca.approve(ibALPACA.address, ether('42000'), { from: bob });
      await ibALPACA.deposit(ether('42000'), { from: bob });
      assert.equal(await alpaca.balanceOf(ibALPACA.address), ether(42200));
      assert.equal(await ibALPACA.balanceOf(bob), ether(21000));

      await ibALPACA.approve(fairLaunch.address, ether(21000), { from: bob });
      await fairLaunch.deposit(bob, 0, ether(21000), { from: bob });
      assert.equal(await alpaca.balanceOf(fairLaunch.address), ether(0));
      assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(21000));

      await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await alpaca.balanceOf(fairLaunch.address), ether(20));
      assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(2000));
      assert.equal(await alpaca.balanceOf(ibALPACA.address), ether(50200));
      assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(25000));
    });

    it('should increase reserve on deposit', async () => {
      assert.equal(await piAlpaca.balanceOf(alice), ether(10000));
      await alpaca.approve(piAlpaca.address, ether(1000), { from: alice });
      await piAlpaca.deposit(ether(1000), { from: alice });
      await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piAlpaca.balanceOf(alice), ether(11000));
      assert.equal(await alpaca.balanceOf(fairLaunch.address), ether('70.4'));
      assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(2200));
      assert.equal(await alpaca.balanceOf(ibALPACA.address), ether(51000));
      assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(25400));
      assert.equal(await alpacaRouter.getUnderlyingStaked(), ether(8800));
      assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(4400));
    });

    it('should decrease reserve on withdrawal', async () => {
      assert.equal(await piAlpaca.balanceOf(alice), ether(10000));

      await piAlpaca.withdraw(ether(1000), { from: alice });
      await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piAlpaca.balanceOf(alice), ether(9000));
      assert.equal(await alpaca.balanceOf(fairLaunch.address), ether('53.6'));
      assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(1800));
      assert.equal(await alpaca.balanceOf(ibALPACA.address), ether(49400));
      assert.equal(await alpacaRouter.getUnderlyingStaked(), ether(7200));
      assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(3600));
      assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(24600));
    });

    it('should ignore rebalancing if the staking address is 0', async () => {
      await alpacaRouter.redeem(ether(8000), { from: piGov });
      await alpacaRouter.setVotingAndStaking(fairLaunch.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await alpaca.balanceOf(fairLaunch.address), ether('36.8'));
      assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(10000));
      assert.equal(await piAlpaca.balanceOf(alice), ether(10000));
      assert.equal(await piAlpaca.totalSupply(), ether(10000));
      await piAlpaca.withdraw(ether(1000), { from: alice });
      assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(21000));
      await expectRevert(alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x'), 'STAKING_IS_NULL');
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await alpacaRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), time.duration.hours(1), {
          from: piGov,
        });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await alpaca.approve(piAlpaca.address, ether(1000), { from: alice });
        await piAlpaca.deposit(ether(1000), { from: alice });
        await expectRevert(alpacaRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should DO rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(121));

        await alpaca.approve(piAlpaca.address, ether(1000), { from: alice });
        await piAlpaca.deposit(ether(1000), { from: alice });
        await alpacaRouter.pokeFromSlasher(0, false, '0x');

        assert.equal(await alpaca.balanceOf(fairLaunch.address), ether('120.8'));
        assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(4400));
        assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piAlpaca.withdraw(ether(1000), { from: alice });
        await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await alpaca.balanceOf(fairLaunch.address), ether(104));
        assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(3600));
        assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(1800));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await alpaca.approve(piAlpaca.address, ether(1000), { from: alice });
        await piAlpaca.deposit(ether(1000), { from: alice });
        await expectRevert(alpacaRouter.pokeFromReporter(0, false, '0x'), 'MIN_INTERVAL_NOT_REACHED');
        await expectRevert(alpacaRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should NOT rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(70));

        await alpaca.approve(piAlpaca.address, ether(1000), { from: alice });
        await piAlpaca.deposit(ether(1000), { from: alice });
        await expectRevert(alpacaRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await alpaca.balanceOf(fairLaunch.address), ether(20));
        assert.equal(await alpaca.balanceOf(ibALPACA.address), ether(50200));
        assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(25000));
        assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(4000));
        assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await alpaca.transfer(piAlpaca.address, ether(1000), { from: alice });

        assert.equal(await alpaca.balanceOf(fairLaunch.address), ether(20));
        assert.equal(await alpaca.balanceOf(ibALPACA.address), ether(50200));
        assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(25000));
        assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(4000));
        assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(3000));

        await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await alpaca.balanceOf(ibALPACA.address), ether(51000));
        assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(25400));
        assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(4400));
        assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(2200));
      });
    });

    it('should stake all the underlying tokens with 0 RR', async () => {
      await alpacaRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, { from: piGov });

      await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(26000));
      assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(0));
    });

    it('should keep all the underlying tokens on piToken with 1 RR', async () => {
      await alpacaRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

      await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(21000));
      assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(10000));
    });
  });

  describe('reward distribution', async () => {
    let poolA, poolB, poolC, poolD;

    beforeEach(async function() {
      poolA = await MockGulpingBPool.new();
      poolB = await MockGulpingBPool.new();
      poolC = await MockGulpingBPool.new();
      poolD = await MockGulpingBPool.new();
      await alpacaRouter.setRewardPools([poolA.address, poolB.address, poolC.address], { from: piGov });

      await poolRestrictions.setVotingAllowedForSenders(fairLaunch.address, [alice], [true]);

      await alpaca.transfer(alice, ether('10000'));
      await alpaca.approve(piAlpaca.address, ether('10000'), { from: alice });
      await piAlpaca.deposit(ether('10000'), { from: alice });

      await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piAlpaca.totalSupply(), ether(10000));
      assert.equal(await piAlpaca.balanceOf(alice), ether(10000));

      await piAlpaca.transfer(poolA.address, 10, { from: alice });
      await piAlpaca.transfer(poolB.address, 20, { from: alice });
    });

    it('should allow distribute the accrued rewards', async () => {
      // Staked: 8000alpaca/4000ibAlpaca; Reserve: 2000alpaca

      await alpaca.transfer(ibALPACA.address, ether(16400));

      assert.equal(await ibALPACA.balanceOf(piAlpaca.address), ether(0));
      assert.equal(await ibALPACA.balanceOf(fairLaunch.address), ether(4000));

      assert.equal((await fairLaunch.userInfo(0, piAlpaca.address)).amount, ether(4000));

      assert.equal(await alpaca.balanceOf(piAlpaca.address), ether(2000));
      // 8000 from piToken; 100 from the initial depositor; 100 as initial reward
      assert.equal(await alpaca.balanceOf(ibALPACA.address), ether(24600));
      assert.equal(await alpacaRouter.getUnderlyingStaked(), ether(24000));
      assert.equal(await alpacaRouter.getPendingRewards(), ether(16000));

      let res = await alpacaRouter.pokeFromReporter(REPORTER_ID, true, '0x', { from: bob });

      expectEvent(res, 'ClaimRewards', {
        sender: bob,
        calculatedAlpacaReward: ether(16000),
        calculatedIbAlpacaReward: ether('2666.666666666666666666'),
        actualAlpacaEarned: ether('15999.999999999999999996'),
      });

      expectEvent(res, 'AutoClaimRewards', {
        sender: bob,
        alpacaRewards: ether(80),
      });

      expectEvent(res, 'DistributeRewards', {
        sender: bob,
        alpacaReward: ether(80),
        pvpReward: ether('12'),
        poolRewardsUnderlying: ether(68),
        poolRewardsPi: ether('26.153846153846153846'),
        pools: [poolA.address, poolB.address, poolC.address],
      });

      assert.equal(await alpaca.balanceOf(piAlpaca.address), ether('21267.999999999999999994'));
      assert.equal(await alpaca.balanceOf(alpacaRouter.address), '0');

      assert.isTrue(parseInt(res.logs[5].args.poolRewardsUnderlying) > 1);
      assert.isTrue(parseInt(res.logs[5].args.poolRewardsPi.length) > 1);

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 6);
      assert.equal(res.logs[3].args.pool, poolA.address);
      assert.equal(res.logs[3].args.amount, ether('8.717948717948717948'));
      assert.equal(res.logs[4].args.pool, poolB.address);
      assert.equal(res.logs[4].args.amount, ether('17.435897435897435897'));

      assert.equal(await piAlpaca.balanceOf(poolA.address), ether('8.717948717948717958'));
      assert.equal(await piAlpaca.balanceOf(poolB.address), ether('17.435897435897435917'));
      assert.equal(await piAlpaca.balanceOf(poolC.address), '0');
      assert.equal(await piAlpaca.balanceOf(poolD.address), '0');

      assert.equal(await alpaca.balanceOf(alpacaRouter.address), '0');
      assert.equal(await alpaca.balanceOf(alpacaRouter.address), '0');
    });

    // TODO: implement
    it.skip('should revert poke if there is nothing released', async () => {
      const dishonestChef = await MockGeneralMasterChef.new(alpaca.address);
      await alpacaRouter.setReserveConfig(ether(1), 0, { from: piGov });
      await alpacaRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      await alpacaRouter.setVotingAndStaking(constants.ZERO_ADDRESS, dishonestChef.address, { from: piGov });
      await alpacaRouter.setReserveConfig(ether('0.2'), 0, { from: piGov });

      // there are still some rewards from rebalancing pokes
      await alpacaRouter.pokeFromReporter(REPORTER_ID, true, '0x');

      // and now there are no rewards
      await expectRevert(alpacaRouter.pokeFromReporter(REPORTER_ID, true, '0x'), 'NO_PENDING_REWARD');
    });

    // TODO: implement
    it.skip('should revert distributing rewards when missing reward pools config', async () => {
      poke = await MockPoke.new(true);
      const router = await AlpacaRouter.new(
        piAlpaca.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          fairLaunch.address,
          fairLaunch.address,
          ether('0.2'),
          ether('0.02'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildAlpacaRouterConfig(alpaca.address, ibALPACA.address, 0),
      );
      await alpacaRouter.migrateToNewRouter(piAlpaca.address, router.address, [], { from: piGov });
      await alpaca.transfer(fairLaunch.address, ether(2000));
      await time.increase(1);
      await expectRevert(router.pokeFromReporter(REPORTER_ID, true, '0x'), 'MISSING_REWARD_POOLS');
    });
  });
});
