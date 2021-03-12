const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, addBN } = require('../../helpers');
const { buildBasicRouterConfig, buildSushiRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const SushiPowerIndexRouter = artifacts.require('SushiPowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const SushiBar = artifacts.require('SushiBar');
const MockSushiBar = artifacts.require('MockSushiBar');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const MockPoke = artifacts.require('MockPoke');

MockERC20.numberFormat = 'String';
SushiPowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
SushiBar.numberFormat = 'String';

const { web3 } = MockERC20;

describe('SushiRouter Tests', () => {
  let bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function () {
    [, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let sushi, xSushi, poolRestrictions, piSushi, sushiRouter, poke;

  beforeEach(async function () {
    // 0x6b3595068778dd592e39a122f4f5a5cf09c90fe2
    sushi = await MockERC20.new('SushiToken', 'SUSHI', '18', ether('10000000'));

    // 0x8798249c2e607446efb7ad49ec89dd1865ff4272
    xSushi = await SushiBar.new(sushi.address);

    poolRestrictions = await PoolRestrictions.new();
    piSushi = await WrappedPiErc20.new(sushi.address, stub, 'Wrapped SUSHI', 'piSUSHI');
    poke = await MockPoke.new();
    sushiRouter = await SushiPowerIndexRouter.new(
      piSushi.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        xSushi.address,
        ether('0.2'),
        ether('0.02'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2]
      ),
      buildSushiRouterConfig(
        sushi.address
      ),
    );

    await piSushi.changeRouter(sushiRouter.address, { from: stub });

    await sushi.transfer(bob, ether(42000));
    await sushi.approve(xSushi.address, ether(42000), { from: bob });
    await xSushi.enter(ether(42000), { from: bob });

    await sushiRouter.transferOwnership(piGov);

    assert.equal(await sushiRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await sushiRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await sushi.transfer(alice, ether('10000'));
        await sushi.approve(piSushi.address, ether('10000'), { from: alice });
        await piSushi.deposit(ether('10000'), { from: alice });

        await sushiRouter.poke(false);

        assert.equal(await sushi.balanceOf(piSushi.address), ether(2000));
        assert.equal(await sushi.balanceOf(xSushi.address), ether(50000));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await sushiRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await sushi.balanceOf(piSushi.address), ether(0));
          assert.equal(await sushi.balanceOf(xSushi.address), ether(52000));
          assert.equal(await xSushi.balanceOf(piSushi.address), ether(10000));
        });

        it('should deny staking 0', async () => {
          await expectRevert(sushiRouter.stake(ether(0), { from: piGov }), 'CANT_STAKE_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(sushiRouter.stake(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      })

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await sushiRouter.redeem(ether(3000), { from: piGov });
          expectEvent(res, 'Redeem', {
            sender: piGov,
            amount: ether(3000),
          });
          assert.equal(await sushi.balanceOf(piSushi.address), ether(5000));
          assert.equal(await xSushi.balanceOf(piSushi.address), ether(5000));
          assert.equal(await sushi.balanceOf(xSushi.address), ether(47000));
        });

        it('should deny staking 0', async () => {
          await expectRevert(sushiRouter.redeem(ether(0), { from: piGov }), 'CANT_REDEEM_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(sushiRouter.redeem(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      })
    });

    describe('setRewardPools()', () => {
      it('should allow the owner setting a new reward pool', async () => {
        const res = await sushiRouter.setRewardPools([alice, bob], { from: piGov });
        expectEvent(res, 'SetRewardPools', {
          len: '2',
          rewardPools: [alice, bob],
        });
      });

      it('should deny setting an empty reward pool', async () => {
        await expectRevert(sushiRouter.setRewardPools([], { from: piGov }), 'AT_LEAST_ONE_EXPECTED');
      });

      it('should deny non-owner setting a new reward pool', async () => {
        await expectRevert(sushiRouter.setRewardPools([alice, bob], { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setPvpFee()', () => {
      it('should allow the owner setting a new pvpFee', async () => {
        const res = await sushiRouter.setPvpFee(ether('0.1'), { from: piGov });
        expectEvent(res, 'SetPvpFee', {
          pvpFee: ether('0.1'),
        });
      });

      it('should deny setting a fee greater or equal 100%', async () => {
        await expectRevert(sushiRouter.setPvpFee(ether('1'), { from: piGov }), 'PVP_FEE_OVER_THE_LIMIT');
      });

      it('should deny non-owner setting a new pvpFee', async () => {
        await expectRevert(sushiRouter.setPvpFee(ether('0'), { from: alice }), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('viewers', () => {
    it('should return the same amount for getPiEquivalentForUnderlying()', async () => {
      assert.equal(await sushiRouter.getPiEquivalentForUnderlying(123, alice, 789), 123);
    });

    it('should return the same amount for getUnderlyingEquivalentForPi()', async () => {
      assert.equal(await sushiRouter.getUnderlyingEquivalentForPi(123, alice, 789), 123);
    });

    it('should return the same amount for getPiEquivalentForUnderlyingPure()', async () => {
      assert.equal(await sushiRouter.getPiEquivalentForUnderlyingPure(123, 456, 789), 123);
    });

    it('should return the same amount for getUnderlyingEquivalentForPiPure()', async () => {
      assert.equal(await sushiRouter.getUnderlyingEquivalentForPiPure(123, 456, 789), 123);
    });
  });

  describe('reserve management', () => {

    beforeEach(async () => {
      await sushi.transfer(alice, ether(100000));
      await sushi.approve(piSushi.address, ether(10000), { from: alice });
      await piSushi.deposit(ether(10000), { from: alice });

      await sushiRouter.poke(false);

      assert.equal(await sushi.balanceOf(xSushi.address), ether(50000));
      assert.equal(await sushi.balanceOf(piSushi.address), ether(2000));
    });

    describe('non-modified xSushi ratio', () => {
      it('should increase reserve on deposit', async () => {
        assert.equal(await piSushi.balanceOf(alice), ether(10000));
        await sushi.approve(piSushi.address, ether(1000), { from: alice });
        await piSushi.deposit(ether(1000), { from: alice });

        await sushiRouter.poke(false, { from: bob });

        assert.equal(await piSushi.balanceOf(alice), ether(11000));
        assert.equal(await sushi.balanceOf(xSushi.address), ether(50800));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(8800));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(2200));
      });

      it('should decrease reserve on withdrawal', async () => {
        assert.equal(await piSushi.balanceOf(alice), ether(10000));

        await piSushi.withdraw(ether(1000), { from: alice });

        await sushiRouter.poke(false, { from: bob });

        assert.equal(await piSushi.balanceOf(alice), ether(9000));
        assert.equal(await sushi.balanceOf(xSushi.address), ether(49200));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(7200));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(1800));
      });
    });

    describe('modified xSushi ratio', () => {
      beforeEach(async () => {
        assert.equal(await piSushi.balanceOf(alice), ether(10000));
        assert.equal(await sushi.balanceOf(xSushi.address), ether(50000));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(8000));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(2000));
        assert.equal(await sushiRouter.getSushiForXSushi(ether(3160)), ether(3160));

        // before SUSHI/xSUSHI ratio was 1
        await sushi.transfer(xSushi.address, ether(30000));
        // after SUSHI/xSUSHI ratio increased to 1.6

        assert.equal(await piSushi.balanceOf(alice), ether(10000));
        assert.equal(await sushi.balanceOf(xSushi.address), ether(80000));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(8000));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(2000));
        assert.equal(await sushiRouter.getUnderlyingStaked(), ether(8000));
        assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), ether(12800));
        assert.equal(await sushiRouter.getSushiForXSushi(ether(2000)), ether(3200));
      });

      it('should mint a smaller amount of xSushi', async () => {
        await sushi.approve(piSushi.address, ether(1000), { from: alice });
        await piSushi.deposit(ether(1000), { from: alice });

        await sushiRouter.poke(false, { from: bob });

        assert.equal(await piSushi.balanceOf(alice), ether(11000));
        assert.equal(await sushi.balanceOf(xSushi.address), ether(80800));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(8500));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(2200));
        assert.equal(await sushiRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), ether(13600));
        assert.equal(await sushiRouter.getPendingRewards(), ether(4800));
        assert.equal(await sushiRouter.getSushiForXSushi(ether(3160)), ether(5056));
      });

      it('should decrease reserve on withdrawal', async () => {
        await piSushi.withdraw(ether(1000), { from: alice });

        await sushiRouter.poke(false, { from: bob });

        assert.equal(await piSushi.balanceOf(alice), ether(9000));
        assert.equal(await sushi.balanceOf(xSushi.address), ether(79200));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(7500));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(1800));
        assert.equal(await sushiRouter.getUnderlyingStaked(), ether(7200));
        assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), ether(12000));
        assert.equal(await sushiRouter.getPendingRewards(), ether(4800));
        assert.equal(await sushiRouter.getSushiForXSushi(ether(3160)), ether(5056));
      });
    });

    it('should revert rebalancing if the staking address is 0', async () => {
      await sushiRouter.redeem(ether(8000), { from: piGov });
      await sushiRouter.setVotingAndStaking(xSushi.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await sushi.balanceOf(xSushi.address), ether(42000));
      assert.equal(await sushi.balanceOf(piSushi.address), ether(10000));
      assert.equal(await piSushi.balanceOf(alice), ether(10000));
      assert.equal(await piSushi.totalSupply(), ether(10000));

      await piSushi.withdraw(ether(1000), { from: alice });

      await expectRevert(sushiRouter.poke(false, { from: bob }), 'STACKING_IS_NULL');

      assert.equal(await sushi.balanceOf(xSushi.address), ether(42000));
      assert.equal(await xSushi.balanceOf(piSushi.address), ether(0));
      assert.equal(await sushi.balanceOf(piSushi.address), ether(9000));
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await sushiRouter.setReserveConfig(ether('0.2'), time.duration.hours(1), { from: piGov });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2));
        await sushiRouter.poke(false, { from: bob });
      });

      it('should DO rebalance on deposit if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await sushi.approve(piSushi.address, ether(1000), { from: alice });
        await piSushi.deposit(ether(1000), { from: alice });
        await sushiRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await sushi.balanceOf(xSushi.address), ether(50800));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(8800));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piSushi.withdraw(ether(1000), { from: alice });
        await sushiRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await sushi.balanceOf(xSushi.address), ether(49200));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(7200));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(1800));
      });

      it('should NOT rebalance if the rebalancing interval hasn\'t passed', async () => {
        await time.increase(time.duration.minutes(59));

        await sushi.approve(piSushi.address, ether(1000), { from: alice });
        await piSushi.deposit(ether(1000), { from: alice });

        assert.equal(await sushiRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), false);
        await expectRevert(sushiRouter.pokeFromReporter('0', false, '0x', { from: bob }), 'MIN_INTERVAL_NOT_REACHED');

        await time.increase(60);

        await sushiRouter.pokeFromReporter('0', false, '0x', { from: bob });
      });

      it('should rebalance if the rebalancing interval not passed but reserveRatioToForceRebalance has reached', async () => {
        await time.increase(time.duration.minutes(59));

        assert.equal(await sushiRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), false);
        await piSushi.withdraw(ether(2000), { from: alice });
        assert.equal(await sushiRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), true);
        await sushiRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await sushi.balanceOf(xSushi.address), ether(48400));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(6400));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(1600));
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await sushiRouter.poke(false, { from: bob });

        assert.equal(await sushi.balanceOf(xSushi.address), ether(50000));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(8000));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await sushi.transfer(piSushi.address, ether(1000), { from: alice });

        assert.equal(await sushi.balanceOf(xSushi.address), ether(50000));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(8000));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(3000));
        assert.equal(await piSushi.totalSupply(), ether(10000));
        assert.equal(await sushiRouter.getUnderlyingStaked(), ether(7000));
        assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), ether(8000));
        assert.equal(await sushiRouter.getPendingRewards(), ether(1000));

        await sushiRouter.poke(false, { from: bob });

        assert.equal(await sushi.balanceOf(xSushi.address), ether(51000));
        assert.equal(await xSushi.balanceOf(piSushi.address), ether(9000));
        assert.equal(await sushi.balanceOf(piSushi.address), ether(2000));
        assert.equal(await piSushi.totalSupply(), ether(10000));
        assert.equal(await sushiRouter.getUnderlyingStaked(), ether(8000));
        assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), ether(9000));
        assert.equal(await sushiRouter.getPendingRewards(), ether(1000));
      });
    });

    it('should stake all the underlying tokens with 0 RR', async () => {
      await sushiRouter.setReserveConfig(ether(0), 0, { from: piGov });

      await sushiRouter.poke(false, { from: bob });
      assert.equal(await sushi.balanceOf(xSushi.address), ether(52000));
      assert.equal(await sushi.balanceOf(piSushi.address), ether(0));
    })

    it('should keep all the underlying tokens on piToken with 1 RR', async () => {
      await sushiRouter.setReserveConfig(ether(1), 0, { from: piGov });

      await sushiRouter.poke(false, { from: bob });
      assert.equal(await sushi.balanceOf(xSushi.address), ether(42000));
      assert.equal(await sushi.balanceOf(piSushi.address), ether(10000));
    })
  });

  describe('reward distribution', async () => {
    let poolA, poolB, poolC, poolD;

    beforeEach(async function () {
      poolA = await MockGulpingBPool.new();
      poolB = await MockGulpingBPool.new();
      poolC = await MockGulpingBPool.new();
      poolD = await MockGulpingBPool.new();
      await sushiRouter.setRewardPools([poolA.address, poolB.address, poolC.address], { from: piGov });

      await poolRestrictions.setVotingAllowedForSenders(xSushi.address, [alice], [true]);

      await sushi.transfer(alice, ether('10000'));
      await sushi.approve(piSushi.address, ether('10000'), { from: alice });
      await piSushi.deposit(ether('10000'), { from: alice });

      await sushiRouter.poke(false);

      assert.equal(await piSushi.totalSupply(), ether('10000'));
      assert.equal(await piSushi.balanceOf(alice), ether('10000'));
      assert.equal(await xSushi.totalSupply(), ether('50000'));

      await piSushi.transfer(poolA.address, 10, { from: alice });
      await piSushi.transfer(poolB.address, 20, { from: alice });
    });

    it('should allow withdrawing rewards from the governance', async () => {
      await sushi.transfer(xSushi.address, ether(2000));

      await time.increase(time.duration.days(8));
      assert.equal(await sushi.balanceOf(piSushi.address), ether(2000));
      assert.equal(await sushiRouter.getUnderlyingStaked(), ether(8000));
      assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), ether(8320));
      assert.equal(await sushiRouter.getPendingRewards(), ether(320));
      assert.equal(await sushiRouter.getXSushiForSushi(ether(320)), '307692307692307692307');

      let res = await sushiRouter.poke(true, { from: bob });
      expectEvent(res, 'ClaimRewards', {
        sender: bob,
        xSushiBurned: '307692307692307692307',
        expectedSushiReward: ether(320),
        releasedSushiReward: '319999999999999999999'
      })

      expectEvent(res, 'DistributeRewards', {
        sender: bob,
        sushiReward: '319999999999999999999',
        pvpReward: '47999999999999999999',
        poolRewardsUnderlying: ether(272),
        poolRewardsPi: ether(272),
        pools: [poolA.address, poolB.address, poolC.address],
      });

      assert.equal(await sushi.balanceOf(piSushi.address), addBN(ether(2000), ether(272)));
      assert.equal(await sushi.balanceOf(sushiRouter.address), '0');

      assert.isTrue(parseInt(res.logs[3].args.poolRewardsUnderlying) > 1);
      assert.isTrue(parseInt(res.logs[3].args.poolRewardsPi.length) > 1);

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 4);
      assert.equal(res.logs[1].args.pool, poolA.address);
      assert.equal(res.logs[1].args.amount, '90666666666666666666');
      assert.equal(res.logs[2].args.pool, poolB.address);
      assert.equal(res.logs[2].args.amount, '181333333333333333333');

      assert.equal(await piSushi.balanceOf(poolA.address), 90666666666666666666 + 10);
      assert.equal(await piSushi.balanceOf(poolB.address), 181333333333333333333 + 20);
      assert.equal(await piSushi.balanceOf(poolC.address), '0');
      assert.equal(await piSushi.balanceOf(poolD.address), '0');

      assert.equal(await sushi.balanceOf(sushiRouter.address), '0');
      assert.equal(await sushi.balanceOf(sushiRouter.address), '0');
    });

    it('should revert poke if there is no reward available', async () => {
      await expectRevert(sushiRouter.poke(true, { from: alice }), 'NOTHING_TO_CLAIM');
    });

    it('should revert poke if there is nothing released', async () => {
      const scammyBar = await MockSushiBar.new(sushi.address);
      await sushiRouter.setReserveConfig(ether(1), 0, { from: piGov });
      await sushiRouter.poke(false);
      await sushiRouter.setVotingAndStaking(constants.ZERO_ADDRESS, scammyBar.address, { from: piGov });
      await sushiRouter.setReserveConfig(ether('0.2'), 0, { from: piGov });
      await sushiRouter.poke(false);
      await sushi.transfer(scammyBar.address, ether(1000));
      await expectRevert(sushiRouter.poke(true, { from: alice }), 'NOTHING_RELEASED');
    });

    it('should revert distributing rewards when missing reward pools config', async () => {
      poke = await MockPoke.new();
      const router = await SushiPowerIndexRouter.new(
        piSushi.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          xSushi.address,
          xSushi.address,
          ether('0.2'),
          ether('0.02'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildSushiRouterConfig(
          sushi.address
        ),
      );
      await sushiRouter.migrateToNewRouter(piSushi.address, router.address, { from: piGov });
      await sushi.transfer(xSushi.address, ether(2000));
      await time.increase(1);
      await expectRevert(router.poke(true, { from: bob }), 'MISSING_REWARD_POOLS');
    });
  });
});
