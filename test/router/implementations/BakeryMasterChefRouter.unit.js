const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber } = require('../../helpers');
const { buildBasicRouterConfig, buildBakeryChefRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const BakeryChefPowerIndexRouter = artifacts.require('BakeryChefPowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockBakeryMasterChef = artifacts.require('MockBakeryMasterChef');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const MockPoke = artifacts.require('MockPoke');

const BakeryMasterChef = artifactFromBytecode('bsc/BakeryMasterChef');
const BakeryToken = artifactFromBytecode('bsc/BakeryToken');

BakeryChefPowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = WrappedPiErc20;

const REPORTER_ID = 42;

describe('BakeryMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function() {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let bake, bakeryChef, poolRestrictions, piBake, myRouter, poke;

  beforeEach(async function() {
    // bsc: 0xe02df9e3e622debdd69fb838bb799e3f168902c5
    bake = await BakeryToken.new('BakeryToken', 'BAKE');

    // bsc: 0x20ec291bb8459b6145317e7126532ce7ece5056f
    bakeryChef = await BakeryMasterChef.new(
      bake.address,
      // devAddress
      deployer,
      // bakeStartBlock - BAKE tokens created first block
      ether(400),
      // startBlock
      await latestBlockNumber(),
      // bonusEndBlock
      (await latestBlockNumber()) + 1000,
      // bonusBeforeBulkBlockSize
      300,
      // bonusBeforeCommonDifference
      ether(10),
      // bonusEndCommonDifference
      ether(10),
    );
    await bake.mintTo(deployer, ether('10000000'));

    poolRestrictions = await PoolRestrictions.new();
    piBake = await WrappedPiErc20.new(bake.address, stub, 'Wrapped BAKE', 'piBAKE');

    poke = await MockPoke.new(true);
    myRouter = await BakeryChefPowerIndexRouter.new(
      piBake.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        bakeryChef.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
      buildBakeryChefRouterConfig(bake.address),
    );

    await piBake.changeRouter(myRouter.address, { from: stub });
    await bakeryChef.add(20306, bake.address, false);
    await myRouter.transferOwnership(piGov);
    await bake.transferOwnership(bakeryChef.address);

    assert.equal(await myRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await myRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await bake.transfer(alice, ether('10000'));
        await bake.approve(piBake.address, ether('10000'), { from: alice });
        await piBake.deposit(ether('10000'), { from: alice });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await bake.balanceOf(piBake.address), ether(2000));
        assert.equal(await bake.balanceOf(bakeryChef.address), ether(8000));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await myRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await bake.balanceOf(piBake.address), ether(0));
          assert.equal(await bake.balanceOf(bakeryChef.address), ether(10000));
          const userInfo = await bakeryChef.poolUserInfoMap(bake.address, piBake.address);
          assert.equal(userInfo.amount, ether(10000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.stake(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await myRouter.redeem(ether(3000), { from: piGov });
          expectEvent(res, 'Redeem', {
            sender: piGov,
            amount: ether(3000),
          });
          assert.equal(await bake.balanceOf(piBake.address), ether(5000));
          const userInfo = await bakeryChef.poolUserInfoMap(bake.address, piBake.address);
          assert.equal(userInfo.amount, ether(5000));
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(myRouter.redeem(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });
    });

    describe('setRewardPools()', () => {
      it('should allow the owner setting a new reward pool', async () => {
        const res = await myRouter.setRewardPools([alice, bob], { from: piGov });
        expectEvent(res, 'SetRewardPools', {
          len: '2',
          rewardPools: [alice, bob],
        });
      });

      it('should deny setting an empty reward pool', async () => {
        await expectRevert(myRouter.setRewardPools([], { from: piGov }), 'AT_LEAST_ONE_EXPECTED');
      });

      it('should deny non-owner setting a new reward pool', async () => {
        await expectRevert(myRouter.setRewardPools([alice, bob], { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setPvpFee()', () => {
      it('should allow the owner setting a new pvpFee', async () => {
        const res = await myRouter.setPvpFee(ether('0.1'), { from: piGov });
        expectEvent(res, 'SetPvpFee', {
          pvpFee: ether('0.1'),
        });
      });

      it('should deny setting a fee greater or equal 100%', async () => {
        await expectRevert(myRouter.setPvpFee(ether('1'), { from: piGov }), 'PVP_FEE_OVER_THE_LIMIT');
      });

      it('should deny non-owner setting a new pvpFee', async () => {
        await expectRevert(myRouter.setPvpFee(ether('0'), { from: alice }), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      // alice
      await bake.transfer(alice, ether('20000'));
      await bake.approve(piBake.address, ether('10000'), { from: alice });
      await piBake.deposit(ether('10000'), { from: alice });

      // bob
      await bake.transfer(bob, ether('42000'));
      await bake.approve(bakeryChef.address, ether('42000'), { from: bob });
      await bakeryChef.deposit(bake.address, ether('42000'), { from: bob });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await bake.balanceOf(bakeryChef.address), ether(50400));
      assert.equal(await bake.balanceOf(piBake.address), ether(2000));
    });

    it('should increase reserve on deposit', async () => {
      assert.equal(await piBake.balanceOf(alice), ether(10000));
      await bake.approve(piBake.address, ether(1000), { from: alice });
      await piBake.deposit(ether(1000), { from: alice });
      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piBake.balanceOf(alice), ether(11000));
      assert.equal(await bake.balanceOf(bakeryChef.address), ether('52209.523809528000000000'));
      assert.equal(await bake.balanceOf(piBake.address), ether(2200));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
      assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8800));
    });

    it('should decrease reserve on withdrawal', async () => {
      assert.equal(await piBake.balanceOf(alice), ether(10000));

      await piBake.withdraw(ether(1000), { from: alice });
      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piBake.balanceOf(alice), ether(9000));
      assert.equal(await bake.balanceOf(bakeryChef.address), ether('50273.015873016000000000'));
      assert.equal(await bake.balanceOf(piBake.address), ether(1800));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(7200));
      assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(7200));
    });

    it('should ignore rebalancing if the staking address is 0', async () => {
      await myRouter.redeem(ether(8000), { from: piGov });
      await myRouter.setVotingAndStaking(bakeryChef.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await bake.balanceOf(bakeryChef.address), ether('42736.507936512000000000'));
      assert.equal(await bake.balanceOf(piBake.address), ether(10000));
      assert.equal(await piBake.balanceOf(alice), ether(10000));
      assert.equal(await piBake.totalSupply(), ether(10000));
      await piBake.withdraw(ether(1000), { from: alice });
      await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, false, '0x'), 'STAKING_IS_NULL');
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await myRouter.setReserveConfig(ether('0.2'), ether('0.1'), ether('0.3'), time.duration.hours(1), { from: piGov });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should DO rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(121));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await myRouter.pokeFromSlasher(0, false, '0x');

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('53219.047619048000000000'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8800));
        assert.equal(await bake.balanceOf(piBake.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piBake.withdraw(ether(1000), { from: alice });
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('51282.539682544000000000'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(7200));
        assert.equal(await bake.balanceOf(piBake.address), ether(1800));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromReporter(0, false, '0x'), 'MIN_INTERVAL_NOT_REACHED');
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should NOT rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(70));

        await bake.approve(piBake.address, ether(1000), { from: alice });
        await piBake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await bake.balanceOf(bakeryChef.address), ether(50400));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8000));
        assert.equal(await bake.balanceOf(piBake.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await bake.transfer(piBake.address, ether(1000), { from: alice });

        assert.equal(await bake.balanceOf(bakeryChef.address), ether(50400));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8000));
        assert.equal(await bake.balanceOf(piBake.address), ether(3000));

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await bake.balanceOf(bakeryChef.address), ether('51873.015873016000000000'));
        assert.equal((await bakeryChef.poolUserInfoMap(bake.address, piBake.address)).amount, ether(8800));
        assert.equal(await bake.balanceOf(piBake.address), ether(2200));
      });
    });

    it('should stake all the underlying tokens with 0 RR', async () => {
      await myRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, { from: piGov });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      assert.equal(await bake.balanceOf(bakeryChef.address), ether('53073.015873016000000000'));
      assert.equal(await bake.balanceOf(piBake.address), ether(0));
    });

    it('should keep all the underlying tokens on piToken with 1 RR', async () => {
      await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      assert.equal(await bake.balanceOf(bakeryChef.address), ether('43073.015873016000000000'));
      assert.equal(await bake.balanceOf(piBake.address), ether(10000));
    });
  });

  describe('reward distribution', async () => {
    let poolA, poolB, poolC, poolD;

    beforeEach(async function() {
      poolA = await MockGulpingBPool.new();
      poolB = await MockGulpingBPool.new();
      poolC = await MockGulpingBPool.new();
      poolD = await MockGulpingBPool.new();
      await myRouter.setRewardPools([poolA.address, poolB.address, poolC.address], { from: piGov });

      await poolRestrictions.setVotingAllowedForSenders(bakeryChef.address, [alice], [true]);

      // await bake.transfer(syrupPool.address, ether(12000));
      await bake.transfer(alice, ether('10000'));
      await bake.approve(piBake.address, ether('10000'), { from: alice });
      await piBake.deposit(ether('10000'), { from: alice });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piBake.totalSupply(), ether('10000'));
      assert.equal(await piBake.balanceOf(alice), ether('10000'));

      await piBake.transfer(poolA.address, 10, { from: alice });
      await piBake.transfer(poolB.address, 20, { from: alice });
    });

    it('should allow distribute the accrued rewards', async () => {
      await bake.transfer(bakeryChef.address, ether(2000));

      assert.equal(await bake.balanceOf(piBake.address), ether(2000));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(8000));
      assert.equal(await myRouter.getPendingRewards(), ether(960));

      let res = await myRouter.pokeFromReporter(REPORTER_ID, true, '0x', { from: bob });

      expectEvent(res, 'DistributeRewards', {
        sender: bob,
        tokenReward: ether(1280),
        pvpReward: ether(192),
        poolRewardsUnderlying: ether(1088),
        poolRewardsPi: ether(1088),
        pools: [poolA.address, poolB.address, poolC.address],
      });

      assert.equal(await bake.balanceOf(piBake.address), ether(3088));
      assert.equal(await bake.balanceOf(myRouter.address), '0');

      assert.isTrue(parseInt(res.logs[3].args.poolRewardsUnderlying) > 1);
      assert.isTrue(parseInt(res.logs[3].args.poolRewardsPi.length) > 1);

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 4);
      assert.equal(res.logs[1].args.pool, poolA.address);
      assert.equal(res.logs[1].args.amount, ether('362.666666666666666666'));
      assert.equal(res.logs[2].args.pool, poolB.address);
      assert.equal(res.logs[2].args.amount, ether('725.333333333333333333'));

      assert.equal(await piBake.balanceOf(poolA.address), ether('362.666666666666666676'));
      assert.equal(await piBake.balanceOf(poolB.address), ether('725.333333333333333353'));
      assert.equal(await piBake.balanceOf(poolC.address), '0');
      assert.equal(await piBake.balanceOf(poolD.address), '0');

      assert.equal(await bake.balanceOf(myRouter.address), '0');
      assert.equal(await bake.balanceOf(myRouter.address), '0');
    });

    it('should revert poke if there is nothing released', async () => {
      const dishonestChef = await MockBakeryMasterChef.new(bake.address);
      await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });
      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      await myRouter.setVotingAndStaking(constants.ZERO_ADDRESS, dishonestChef.address, { from: piGov });
      await myRouter.setReserveConfig(ether('0.2'), ether('0.1'), ether('0.3'), 0, { from: piGov });

      // there are still some rewards from rebalancing pokes
      await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');

      // and now there are no rewards
      await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, true, '0x'), 'NO_PENDING_REWARD');
    });

    it('should revert distributing rewards when missing reward pools config', async () => {
      poke = await MockPoke.new(true);
      const router = await BakeryChefPowerIndexRouter.new(
        piBake.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          bakeryChef.address,
          bakeryChef.address,
          ether('0.2'),
          ether('0.02'),
          ether('0.3'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildBakeryChefRouterConfig(bake.address),
      )
      await myRouter.migrateToNewRouter(piBake.address, router.address, [], { from: piGov });
      await bake.transfer(bakeryChef.address, ether(2000));
      await time.increase(1);
      await expectRevert(router.pokeFromReporter(REPORTER_ID, true, '0x'), 'MISSING_REWARD_POOLS');
    });
  });
});
