const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode, latestBlockNumber } = require('../../helpers');
const { buildBasicRouterConfig, buildMasterChefRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const MDXChefPowerIndexRouter = artifacts.require('MasterChefPowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockGeneralMasterChef = artifacts.require('MockGeneralMasterChef');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const MockPoke = artifacts.require('MockPoke');

const BoardRoomMDX = artifactFromBytecode('bsc/BoardRoomMDX');
const BakeryToken = artifactFromBytecode('bsc/MdxToken');

MDXChefPowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = WrappedPiErc20;

describe('MDXMasterChefRouter Tests', () => {
  let deployer, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function() {
    [deployer, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let mdx, boardRoomMDX, poolRestrictions, piMdx, myRouter, poke;

  beforeEach(async function() {
    // bsc: 0x9c65ab58d8d978db963e63f2bfb7121627e3a739
    mdx = await BakeryToken.new();

    // bsc: 0x6aee12e5eb987b3be1ba8e621be7c4804925ba68
    boardRoomMDX = await BoardRoomMDX.new(
      mdx.address,
      28800
    );
    await mdx.addMinter(deployer);
    await mdx.mint(deployer, ether('10000000'));

    poolRestrictions = await PoolRestrictions.new();
    piMdx = await WrappedPiErc20.new(mdx.address, stub, 'Wrapped MDX', 'piMDX');

    poke = await MockPoke.new(true);
    myRouter = await MDXChefPowerIndexRouter.new(
      piMdx.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        boardRoomMDX.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
      buildMasterChefRouterConfig(mdx.address, 0),
    );

    await piMdx.changeRouter(myRouter.address, { from: stub });
    await boardRoomMDX.add(10000, mdx.address, true);
    await myRouter.transferOwnership(piGov);
    await mdx.transferOwnership(boardRoomMDX.address);

    // setting up rewards
    await mdx.approve(boardRoomMDX.address, ether(518400));
    const mdxPerBlock = ether(12);
    const startBlock = await latestBlockNumber();
    await boardRoomMDX.newReward(ether(518400), mdxPerBlock, startBlock);

    assert.equal(await myRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await myRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await mdx.transfer(alice, ether('10000'));
        await mdx.approve(piMdx.address, ether('10000'), { from: alice });
        await piMdx.deposit(ether('10000'), { from: alice });

        await myRouter.poke(false);

        assert.equal(await mdx.balanceOf(piMdx.address), ether(2000));
        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(526400));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await myRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await mdx.balanceOf(piMdx.address), ether(0));
          assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(528388));
          const userInfo = await boardRoomMDX.userInfo(0, piMdx.address);
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
          assert.equal(await mdx.balanceOf(piMdx.address), ether(5000));
          const userInfo = await boardRoomMDX.userInfo(0, piMdx.address);
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
      await mdx.transfer(alice, ether('20000'));
      await mdx.approve(piMdx.address, ether('10000'), { from: alice });
      await piMdx.deposit(ether('10000'), { from: alice });

      // bob
      await mdx.transfer(bob, ether('42000'));
      await mdx.approve(boardRoomMDX.address, ether('42000'), { from: bob });

      await boardRoomMDX.deposit(0, ether('42000'), { from: bob });

      await myRouter.poke(false);

      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(518400 + 50000));
      assert.equal(await mdx.balanceOf(piMdx.address), ether(2000));
    });

    it('should increase reserve on deposit', async () => {
      assert.equal(await piMdx.balanceOf(alice), ether(10000));
      await mdx.approve(piMdx.address, ether(1000), { from: alice });
      await piMdx.deposit(ether(1000), { from: alice });
      await myRouter.poke(false);

      assert.equal(await piMdx.balanceOf(alice), ether(11000));
      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('569194.240000000000000000'));
      assert.equal(await mdx.balanceOf(piMdx.address), ether(2200));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(8800));
      assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8800));
    });

    it('should decrease reserve on withdrawal', async () => {
      assert.equal(await piMdx.balanceOf(alice), ether(10000));

      await piMdx.withdraw(ether(1000), { from: alice });
      await myRouter.poke(false);

      assert.equal(await piMdx.balanceOf(alice), ether(9000));
      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('567596.160000000000000000'));
      assert.equal(await mdx.balanceOf(piMdx.address), ether(1800));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(7200));
      assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(7200));
    });

    it('should ignore rebalancing if the staking address is 0', async () => {
      await myRouter.redeem(ether(8000), { from: piGov });
      await myRouter.setVotingAndStaking(boardRoomMDX.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('560398.080000000000000000'));
      assert.equal(await mdx.balanceOf(piMdx.address), ether(10000));
      assert.equal(await piMdx.balanceOf(alice), ether(10000));
      assert.equal(await piMdx.totalSupply(), ether(10000));
      await piMdx.withdraw(ether(1000), { from: alice });
      await expectRevert(myRouter.poke(false), 'STAKING_IS_NULL');
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await myRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), time.duration.hours(1), { from: piGov });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await mdx.approve(piMdx.address, ether(1000), { from: alice });
        await piMdx.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should DO rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(121));

        await mdx.approve(piMdx.address, ether(1000), { from: alice });
        await piMdx.deposit(ether(1000), { from: alice });
        await myRouter.pokeFromSlasher(0, false, '0x');

        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('569188.480000000000000000'));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8800));
        assert.equal(await mdx.balanceOf(piMdx.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piMdx.withdraw(ether(1000), { from: alice });
        await myRouter.poke(false);

        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('567590.400000000000000000'));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(7200));
        assert.equal(await mdx.balanceOf(piMdx.address), ether(1800));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await mdx.approve(piMdx.address, ether(1000), { from: alice });
        await piMdx.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromReporter(0, false, '0x'), 'MIN_INTERVAL_NOT_REACHED');
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should NOT rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(70));

        await mdx.approve(piMdx.address, ether(1000), { from: alice });
        await piMdx.deposit(ether(1000), { from: alice });
        await expectRevert(myRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await myRouter.poke(false, { from: bob });

        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(568400));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8000));
        assert.equal(await mdx.balanceOf(piMdx.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await mdx.transfer(piMdx.address, ether(1000), { from: alice });

        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether(568400));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8000));
        assert.equal(await mdx.balanceOf(piMdx.address), ether(3000));

        await myRouter.poke(false, { from: bob });

        assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('569196.160000000000000000'));
        assert.equal((await boardRoomMDX.userInfo(0, piMdx.address)).amount, ether(8800));
        assert.equal(await mdx.balanceOf(piMdx.address), ether(2200));
      });
    });

    it('should stake all the underlying tokens with 0 RR', async () => {
      await myRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, { from: piGov });

      await myRouter.poke(false, { from: bob });
      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('570396.160000000000000000'));
      assert.equal(await mdx.balanceOf(piMdx.address), ether(0));
    });

    it('should keep all the underlying tokens on piToken with 1 RR', async () => {
      await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

      await myRouter.poke(false, { from: bob });
      assert.equal(await mdx.balanceOf(boardRoomMDX.address), ether('560396.160000000000000000'));
      assert.equal(await mdx.balanceOf(piMdx.address), ether(10000));
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

      await poolRestrictions.setVotingAllowedForSenders(boardRoomMDX.address, [alice], [true]);

      // await bake.transfer(syrupPool.address, ether(12000));
      await mdx.transfer(alice, ether('10000'));
      await mdx.approve(piMdx.address, ether('10000'), { from: alice });
      await piMdx.deposit(ether('10000'), { from: alice });

      await myRouter.poke(false);

      assert.equal(await piMdx.totalSupply(), ether('10000'));
      assert.equal(await piMdx.balanceOf(alice), ether('10000'));

      await piMdx.transfer(poolA.address, 10, { from: alice });
      await piMdx.transfer(poolB.address, 20, { from: alice });
    });

    it('should allow distribute the accrued rewards', async () => {
      await mdx.transfer(boardRoomMDX.address, ether(2000));

      assert.equal(await mdx.balanceOf(piMdx.address), ether(2000));
      assert.equal(await myRouter.getUnderlyingStaked(), ether(8000));
      assert.equal(await myRouter.getPendingRewards(), ether(36));

      let res = await myRouter.poke(true, { from: bob });

      expectEvent(res, 'DistributeRewards', {
        sender: bob,
        tokenReward: ether(48),
        pvpReward: ether('7.2'),
        poolRewardsUnderlying: ether('40.8'),
        poolRewardsPi: ether('40.8'),
        pools: [poolA.address, poolB.address, poolC.address],
      });

      assert.equal(await mdx.balanceOf(piMdx.address), ether('2040.8'));
      assert.equal(await mdx.balanceOf(myRouter.address), '0');

      assert.isTrue(parseInt(res.logs[3].args.poolRewardsUnderlying) > 1);
      assert.isTrue(parseInt(res.logs[3].args.poolRewardsPi.length) > 1);

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 4);
      assert.equal(res.logs[1].args.pool, poolA.address);
      assert.equal(res.logs[1].args.amount, ether('13.6'));
      assert.equal(res.logs[2].args.pool, poolB.address);
      assert.equal(res.logs[2].args.amount, ether('27.2'));

      assert.equal(await piMdx.balanceOf(poolA.address), ether('13.600000000000000010'));
      assert.equal(await piMdx.balanceOf(poolB.address), ether('27.200000000000000020'));
      assert.equal(await piMdx.balanceOf(poolC.address), '0');
      assert.equal(await piMdx.balanceOf(poolD.address), '0');

      assert.equal(await mdx.balanceOf(myRouter.address), '0');
      assert.equal(await mdx.balanceOf(myRouter.address), '0');
    });

    it('should revert poke if there is nothing released', async () => {
      const dishonestChef = await MockGeneralMasterChef.new(mdx.address);
      await myRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });
      await myRouter.poke(false);
      await myRouter.setVotingAndStaking(constants.ZERO_ADDRESS, dishonestChef.address, { from: piGov });
      await myRouter.setReserveConfig(ether('0.2'), ether(0), ether(1), 0, { from: piGov });

      // there are still some rewards from rebalancing pokes
      await myRouter.poke(true, { from: alice });

      // and now there are no rewards
      await expectRevert(myRouter.poke(true, { from: alice }), 'NO_PENDING_REWARD');
    });

    it('should revert distributing rewards when missing reward pools config', async () => {
      poke = await MockPoke.new(true);
      const router = await MDXChefPowerIndexRouter.new(
        piMdx.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          boardRoomMDX.address,
          boardRoomMDX.address,
          ether('0.2'),
          ether('0.02'),
          ether('0.3'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildMasterChefRouterConfig(mdx.address, 0),
      )
      await myRouter.migrateToNewRouter(piMdx.address, router.address, [], { from: piGov });
      await mdx.transfer(boardRoomMDX.address, ether(2000));
      await time.increase(1);
      await expectRevert(router.poke(true, { from: bob }), 'MISSING_REWARD_POOLS');
    });
  });
});
