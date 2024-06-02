const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber } = require('../../helpers');
const { buildBasicRouterConfig, buildPancakeMasterChefRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const PancakeMasterChefIndexRouter = artifacts.require('PancakeMasterChefIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockPancakeMasterChef = artifacts.require('MockPancakeMasterChef');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const MockPoke = artifacts.require('MockPoke');

const PancakeMasterChef = artifactFromBytecode('bsc/PancakeMasterChef');
const PancakeSyrupPool = artifactFromBytecode('bsc/PancakeSyrupPool');

MockERC20.numberFormat = 'String';
PancakeMasterChefIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = MockERC20;

const REPORTER_ID = 42;

describe('PancakeMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function() {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let cake, syrupPool, masterChef, poolRestrictions, piCake, myRouter, poke;

  beforeEach(async function() {
    // bsc: 0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82
    cake = await MockERC20.new('PancakeSwap Token', 'Cake', '18', ether('10000000'));
    // bsc: 0x009cf7bc57584b7998236eff51b98a168dcea9b0
    syrupPool = await PancakeSyrupPool.new(cake.address);
    // bsc: 0x73feaa1ee314f8c655e354234017be2193c9e24e
    masterChef = await PancakeMasterChef.new(
      cake.address,
      syrupPool.address,
      deployer,
      ether(40),
      await latestBlockNumber(),
    );

    poolRestrictions = await PoolRestrictions.new();
    piCake = await WrappedPiErc20.new(cake.address, stub, 'Wrapped CAKE', 'piCAKE');

    poke = await MockPoke.new(true);
    myRouter = await PancakeMasterChefIndexRouter.new(
      piCake.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        masterChef.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
      buildPancakeMasterChefRouterConfig(cake.address),
    );

    await syrupPool.transferOwnership(masterChef.address);
    await piCake.changeRouter(myRouter.address, { from: stub });
    await masterChef.add(20306, cake.address, false);
    await myRouter.transferOwnership(piGov);

    assert.equal(await myRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await myRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await cake.transfer(alice, ether('10000'));
        await cake.approve(piCake.address, ether('10000'), { from: alice });
        await piCake.deposit(ether('10000'), { from: alice });

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await cake.balanceOf(piCake.address), ether(2000));
        assert.equal(await cake.balanceOf(masterChef.address), ether(8000));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await myRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await cake.balanceOf(piCake.address), ether(0));
          assert.equal(await cake.balanceOf(masterChef.address), ether(10000));
          const userInfo = await masterChef.userInfo(0, piCake.address);
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
          assert.equal(await cake.balanceOf(piCake.address), ether(5000));
          const userInfo = await masterChef.userInfo(0, piCake.address);
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
      await cake.transfer(alice, ether('20000'));
      await cake.approve(piCake.address, ether('10000'), { from: alice });
      await piCake.deposit(ether('10000'), { from: alice });

      // bob
      await cake.transfer(bob, ether('42000'));
      await cake.approve(masterChef.address, ether('42000'), { from: bob });
      await masterChef.enterStaking(ether('42000'), { from: bob });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await cake.balanceOf(masterChef.address), ether(50000));
      assert.equal(await cake.balanceOf(piCake.address), ether(2000));
    });

    it('should increase reserve on deposit', async () => {
      assert.equal(await piCake.balanceOf(alice), ether(10000));
      await cake.approve(piCake.address, ether(1000), { from: alice });
      await piCake.deposit(ether(1000), { from: alice });
      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piCake.balanceOf(alice), ether(11000));
      assert.equal(await cake.balanceOf(masterChef.address), ether(50800));
      assert.equal(await cake.balanceOf(piCake.address), ether(2200));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
      assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8800));
    });

    it('should decrease reserve on withdrawal', async () => {
      assert.equal(await piCake.balanceOf(alice), ether(10000));

      await piCake.withdraw(ether(1000), { from: alice });
      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piCake.balanceOf(alice), ether(9000));
      assert.equal(await cake.balanceOf(masterChef.address), ether(49200));
      assert.equal(await cake.balanceOf(piCake.address), ether(1800));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(7200));
      assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(7200));
    });

    it('should ignore rebalancing if the staking address is 0', async () => {
      await myRouter.redeem(ether(8000), { from: piGov });
      await myRouter.setVotingAndStaking(masterChef.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await cake.balanceOf(masterChef.address), ether(42000));
      assert.equal(await cake.balanceOf(piCake.address), ether(10000));
      assert.equal(await piCake.balanceOf(alice), ether(10000));
      assert.equal(await piCake.totalSupply(), ether(10000));
      await piCake.withdraw(ether(1000), { from: alice });
      await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, false, '0x'), 'STAKING_IS_NULL');
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await myRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), time.duration.hours(1), { from: piGov });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should DO rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(121));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await myRouter.pokeFromSlasher(0, false, '0x');

        assert.equal(await cake.balanceOf(masterChef.address), ether(50800));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8800));
        assert.equal(await cake.balanceOf(piCake.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piCake.withdraw(ether(1000), { from: alice });
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await cake.balanceOf(masterChef.address), ether(49200));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(7200));
        assert.equal(await cake.balanceOf(piCake.address), ether(1800));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromReporter(0, false, '0x'), 'MIN_INTERVAL_NOT_REACHED');
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should NOT rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(70));

        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await cake.balanceOf(masterChef.address), ether(50000));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));
        assert.equal(await cake.balanceOf(piCake.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await cake.transfer(piCake.address, ether(1000), { from: alice });

        assert.equal(await cake.balanceOf(masterChef.address), ether(50000));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8000));
        assert.equal(await cake.balanceOf(piCake.address), ether(3000));

        await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await cake.balanceOf(masterChef.address), ether(50800));
        assert.equal((await masterChef.userInfo(0, piCake.address)).amount, ether(8800));
        assert.equal(await cake.balanceOf(piCake.address), ether(2200));
      });
    });

    it('should stake all the underlying tokens with 0 RR', async () => {
      await myRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, { from: piGov });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      assert.equal(await cake.balanceOf(masterChef.address), ether(52000));
      assert.equal(await cake.balanceOf(piCake.address), ether(0));
    });

    it('should keep all the underlying tokens on piToken with 1 RR', async () => {
      await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      assert.equal(await cake.balanceOf(masterChef.address), ether(42000));
      assert.equal(await cake.balanceOf(piCake.address), ether(10000));
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

      await poolRestrictions.setVotingAllowedForSenders(masterChef.address, [alice], [true]);

      await cake.transfer(syrupPool.address, ether(12000));
      await cake.transfer(alice, ether('10000'));
      await cake.approve(piCake.address, ether('10000'), { from: alice });
      await piCake.deposit(ether('10000'), { from: alice });

      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piCake.totalSupply(), ether('10000'));
      assert.equal(await piCake.balanceOf(alice), ether('10000'));

      await piCake.transfer(poolA.address, 10, { from: alice });
      await piCake.transfer(poolB.address, 20, { from: alice });
    });

    it('should allow withdrawing rewards from the masterChef', async () => {
      await cake.transfer(masterChef.address, ether(2000));

      await masterChef.massUpdatePools();
      await time.increase(time.duration.days(8));
      await masterChef.massUpdatePools();
      assert.equal(await cake.balanceOf(piCake.address), ether(2000));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(8000));
      assert.equal(await myRouter.getPendingRewards(), ether('47.996454152000000000'));

      let res = await myRouter.pokeFromReporter(REPORTER_ID, true, '0x', { from: bob });

      expectEvent(res, 'DistributeRewards', {
        sender: bob,
        tokenReward: ether('55.995863176000000000'),
        pvpReward: ether('8.399379476400000000'),
        poolRewardsUnderlying: ether('47.596483699600000000'),
        poolRewardsPi: ether('47.596483699600000000'),
        pools: [poolA.address, poolB.address, poolC.address],
      });

      assert.equal(await cake.balanceOf(piCake.address), ether('2047.596483699600000000'));
      assert.equal(await cake.balanceOf(myRouter.address), '0');

      assert.isTrue(parseInt(res.logs[3].args.poolRewardsUnderlying) > 1);
      assert.isTrue(parseInt(res.logs[3].args.poolRewardsPi.length) > 1);

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 4);
      assert.equal(res.logs[1].args.pool, poolA.address);
      assert.equal(res.logs[1].args.amount, '15865494566533333333');
      assert.equal(res.logs[2].args.pool, poolB.address);
      assert.equal(res.logs[2].args.amount, '31730989133066666666');

      assert.equal(await piCake.balanceOf(poolA.address), 15865494566533333343);
      assert.equal(await piCake.balanceOf(poolB.address), 31730989133066666686);
      assert.equal(await piCake.balanceOf(poolC.address), '0');
      assert.equal(await piCake.balanceOf(poolD.address), '0');

      assert.equal(await cake.balanceOf(myRouter.address), '0');
      assert.equal(await cake.balanceOf(myRouter.address), '0');
    });

    it('should revert poke if there is nothing released', async () => {
      const dishonestChef = await MockPancakeMasterChef.new(cake.address);
      await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });
      await myRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      await myRouter.setVotingAndStaking(constants.ZERO_ADDRESS, dishonestChef.address, { from: piGov });
      await myRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), 0, { from: piGov });
      await myRouter.pokeFromReporter(REPORTER_ID, true, '0x');
      await expectRevert(myRouter.pokeFromReporter(REPORTER_ID, true, '0x'), 'NO_PENDING_REWARD');
    });

    it('should revert distributing rewards when missing reward pools config', async () => {
      poke = await MockPoke.new(true);
      const router = await PancakeMasterChefIndexRouter.new(
        piCake.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          masterChef.address,
          masterChef.address,
          ether('0.2'),
          ether('0.02'),
          ether('0.3'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildPancakeMasterChefRouterConfig(cake.address),
      );
      await myRouter.migrateToNewRouter(piCake.address, router.address, [], { from: piGov });
      await cake.transfer(masterChef.address, ether(2000));
      await time.increase(1);
      await expectRevert(router.pokeFromReporter(REPORTER_ID, true, '0x'), 'MISSING_REWARD_POOLS');
    });
  });
});
