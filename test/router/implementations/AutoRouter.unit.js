const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, addBN, artifactFromBytecode } = require('../../helpers');
const { buildBasicRouterConfig, buildAutoRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const MockWETH = artifacts.require('MockWETH');
const AutoPowerIndexRouter = artifacts.require('AutoPowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockAutoMasterChef = artifacts.require('MockAutoMasterChef');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const MockPoke = artifacts.require('MockPoke');
const MockPancakeMasterChef = artifacts.require('MockPancakeMasterChef');
const MockPancakeRouter = artifacts.require('MockPancakeRouter');

MockERC20.numberFormat = 'String';
AutoPowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
MockWETH.numberFormat = 'String';

const AutoFarmV2_CrossChain = artifactFromBytecode('bsc/AutoFarmV2_CrossChain');
const StratX2_AUTO = artifactFromBytecode('bsc/StratX2_AUTO');

const DEAD = '0x000000000000000000000000000000000000dead';

const { web3 } = MockERC20;

describe('AutoRouter Tests', () => {
  let autoOwner, bob, alice, piGov, stub, pvp, pool1, pool2;

  before(async function () {
    [, autoOwner, bob, alice, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let auto, autoFarm, autoStrategy, poolRestrictions, piAuto, pancakeRouter, autoRouter, poke, wbnb;

  beforeEach(async function () {
    // bsc: 0xa184088a740c695e156f91f5cc086a06bb78b827
    auto = await MockERC20.new('AUTOv2', 'AUTO', '18', ether('10000000'));

    pancakeRouter = await MockPancakeRouter.new();

    const pancakeMasterChef = await MockPancakeMasterChef.new(auto.address);
    await pancakeMasterChef.setDoTransfer(false);
    wbnb = await MockWETH.new();

    // bsc: 0x763a05bdb9f8946d8c3fa72d1e0d3f5e68647e5c
    autoFarm = await AutoFarmV2_CrossChain.new();
    // bsc: 0xB27150dc6EE59ad4464cC7A89229b5870e568Be2
    autoStrategy = await StratX2_AUTO.new(
      [
        // wbnb
        wbnb.address,
        // gov
        autoOwner,
        // autoFarm
        autoFarm.address,
        // AUTO
        auto.address,
        // want
        auto.address,
        // token0
        DEAD,
        // token1
        DEAD,
        // earned (bnb)
        wbnb.address,
        // fromContract, (set to the pancake mock in order to allow calling farm() which updates actual wantLockedTotal)
        pancakeMasterChef.address,
        // uniRouter
        pancakeRouter.address,
        // rewards
        DEAD,
        // buyBack
        DEAD
      ],
      // pid
      0,
      // isCAKEStaking
      false,
      // isSameAssetDeposit
      true,
      // isAutoComp,
      true,
      [alice, bob],
      [],
      [],
      [],
      [],
      // controllerFee
      0,
      // buyBackRate
      0,
      // _entranceFeeFactor
      10000,
      // _withdrawFeeFactor
      10000,
      // _minTimeToWithdraw
      604800,
    );

    poolRestrictions = await PoolRestrictions.new();
    piAuto = await WrappedPiErc20.new(auto.address, stub, 'Wrapped AUTO', 'piAUTO');
    poke = await MockPoke.new(true);
    autoRouter = await AutoPowerIndexRouter.new(
      piAuto.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        autoFarm.address,
        ether('0.2'),
        ether('0.02'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2]
      ),
      buildAutoRouterConfig(
        auto.address
      ),
    );

    await autoFarm.add(0, auto.address, false, autoStrategy.address);
    await piAuto.changeRouter(autoRouter.address, { from: stub });

    await auto.transfer(bob, ether(42000));
    await auto.approve(autoFarm.address, ether(42000), { from: bob });
    await autoFarm.deposit(0, ether(42000), { from: bob });

    await autoRouter.transferOwnership(piGov);

    assert.equal(await autoRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await autoRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await auto.transfer(alice, ether('10000'));
        await auto.approve(piAuto.address, ether('10000'), { from: alice });
        await piAuto.deposit(ether('10000'), { from: alice });

        await autoRouter.poke(false);

        assert.equal(await auto.balanceOf(piAuto.address), ether(2000));
        assert.equal(await auto.balanceOf(autoStrategy.address), ether(50000));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(8000));
      });

      describe('stake()', () => {

        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await autoRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await auto.balanceOf(piAuto.address), ether(0));
          assert.equal(await auto.balanceOf(autoStrategy.address), ether(52000));
          assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(10000));
        });

        it('should deny staking 0', async () => {
          await expectRevert(autoRouter.stake(ether(0), { from: piGov }), 'CANT_STAKE_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(autoRouter.stake(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      })

      describe('redeem()', () => {
        beforeEach(async () => {
          await time.increase(time.duration.weeks(1));
        });

        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await autoRouter.redeem(ether(3000), { from: piGov });
          expectEvent(res, 'Redeem', {
            sender: piGov,
            amount: ether(3000),
          });
          assert.equal(await auto.balanceOf(piAuto.address), ether(5000));
          assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(5000));
          assert.equal(await auto.balanceOf(autoStrategy.address), ether(47000));
        });

        it('should deny redeeming 0', async () => {
          await expectRevert(autoRouter.redeem(ether(0), { from: piGov }), 'CANT_REDEEM_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(autoRouter.redeem(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      })
    });

    describe('setRewardPools()', () => {
      it('should allow the owner setting a new reward pool', async () => {
        const res = await autoRouter.setRewardPools([alice, bob], { from: piGov });
        expectEvent(res, 'SetRewardPools', {
          len: '2',
          rewardPools: [alice, bob],
        });
      });

      it('should deny setting an empty reward pool', async () => {
        await expectRevert(autoRouter.setRewardPools([], { from: piGov }), 'AT_LEAST_ONE_EXPECTED');
      });

      it('should deny non-owner setting a new reward pool', async () => {
        await expectRevert(autoRouter.setRewardPools([alice, bob], { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setPvpFee()', () => {
      it('should allow the owner setting a new pvpFee', async () => {
        const res = await autoRouter.setPvpFee(ether('0.1'), { from: piGov });
        expectEvent(res, 'SetPvpFee', {
          pvpFee: ether('0.1'),
        });
      });

      it('should deny setting a fee greater or equal 100%', async () => {
        await expectRevert(autoRouter.setPvpFee(ether('1'), { from: piGov }), 'PVP_FEE_OVER_THE_LIMIT');
      });

      it('should deny non-owner setting a new pvpFee', async () => {
        await expectRevert(autoRouter.setPvpFee(ether('0'), { from: alice }), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('viewers', () => {
    it('should return the same amount for getPiEquivalentForUnderlying()', async () => {
      assert.equal(await autoRouter.getPiEquivalentForUnderlying(123, alice, 789), 123);
    });

    it('should return the same amount for getUnderlyingEquivalentForPi()', async () => {
      assert.equal(await autoRouter.getUnderlyingEquivalentForPi(123, alice, 789), 123);
    });

    it('should return the same amount for getPiEquivalentForUnderlyingPure()', async () => {
      assert.equal(await autoRouter.getPiEquivalentForUnderlyingPure(123, 456, 789), 123);
    });

    it('should return the same amount for getUnderlyingEquivalentForPiPure()', async () => {
      assert.equal(await autoRouter.getUnderlyingEquivalentForPiPure(123, 456, 789), 123);
    });
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      await auto.transfer(alice, ether(100000));
      await auto.approve(piAuto.address, ether(10000), { from: alice });
      await piAuto.deposit(ether(10000), { from: alice });

      await autoRouter.poke(false);

      assert.equal(await auto.balanceOf(autoStrategy.address), ether(50000));
      assert.equal(await auto.balanceOf(piAuto.address), ether(2000));
    });

    describe('non-modified auto/share ratio', () => {
      it('should increase reserve on deposit', async () => {
        assert.equal(await piAuto.balanceOf(alice), ether(10000));
        await auto.approve(piAuto.address, ether(1000), { from: alice });
        await piAuto.deposit(ether(1000), { from: alice });

        await autoRouter.poke(false, { from: bob });

        assert.equal(await piAuto.balanceOf(alice), ether(11000));
        assert.equal(await auto.balanceOf(autoStrategy.address), ether(50800));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(8800));
        assert.equal(await auto.balanceOf(piAuto.address), ether(2200));
      });

      it('should decrease reserve on withdrawal', async () => {
        assert.equal(await piAuto.balanceOf(alice), ether(10000));

        await time.increase(time.duration.weeks(1));
        await piAuto.withdraw(ether(1000), { from: alice });

        await autoRouter.poke(false, { from: bob });

        assert.equal(await piAuto.balanceOf(alice), ether(9000));
        assert.equal(await auto.balanceOf(autoStrategy.address), ether(49200));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(7200));
        assert.equal(await auto.balanceOf(piAuto.address), ether(1800));
      });
    });

    describe('modified auto/share ratio', () => {
      beforeEach(async () => {
        assert.equal(await piAuto.balanceOf(alice), ether(10000));
        assert.equal(await auto.balanceOf(autoStrategy.address), ether(50000));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(8000));
        assert.equal(await autoFarm.userInfo(0, piAuto.address), ether(8000));
        assert.equal(await auto.balanceOf(piAuto.address), ether(2000));
        // share/auto ratio is same
        assert.equal(await autoRouter.getAutoForShares(ether(3160)), ether(3160));

        // before AUTO/Shares ratio was 1
        await auto.transfer(autoStrategy.address, ether(30000));
        // after AUTO/Shares ratio increased to 1.6
        // call earn with a fake Pancake router in order to make wantLockedTotal update balance cache
        await autoStrategy.earn({ from: autoOwner });

        assert.equal(await piAuto.balanceOf(alice), ether(10000));
        assert.equal(await auto.balanceOf(autoStrategy.address), ether(80000));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(12800));
        assert.equal(await autoFarm.userInfo(0, piAuto.address), ether(8000));
        assert.equal(await auto.balanceOf(piAuto.address), ether(2000));
        assert.equal(await autoRouter.getUnderlyingStaked(), ether(8000));
        assert.equal(await autoStrategy.sharesTotal(), ether(50000));
        assert.equal(await autoStrategy.wantLockedTotal(), ether(80000));
        assert.equal(await autoRouter.getUnderlyingOnAutoFarm(), ether(12800));
        assert.equal(await autoRouter.getAutoForShares(ether(2000)), ether(3200));
      });

      it('should mint a smaller amount of xSushi', async () => {
        await auto.approve(piAuto.address, ether(1000), { from: alice });
        await piAuto.deposit(ether(1000), { from: alice });

        await autoRouter.poke(false, { from: bob });

        assert.equal(await piAuto.balanceOf(alice), ether(11000));
        assert.equal(await auto.balanceOf(autoStrategy.address), ether(80800));
        assert.equal(await autoFarm.userInfo(0, piAuto.address), ether(8500));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(13600));
        assert.equal(await auto.balanceOf(piAuto.address), ether(2200));
        assert.equal(await autoRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await autoRouter.getUnderlyingOnAutoFarm(), ether(13600));
        assert.equal(await autoRouter.getPendingRewards(), ether(4800));
        assert.equal(await autoRouter.getAutoForShares(ether(3160)), ether(5056));
      });

      it('should decrease reserve on withdrawal', async () => {
        await time.increase(time.duration.weeks(1));
        await piAuto.withdraw(ether(1000), { from: alice });

        await autoRouter.poke(false, { from: bob });

        assert.equal(await piAuto.balanceOf(alice), ether(9000));
        assert.equal(await auto.balanceOf(autoStrategy.address), ether(79200));
        assert.equal(await autoFarm.userInfo(0, piAuto.address), ether(7500));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(12000));
        assert.equal(await auto.balanceOf(piAuto.address), ether(1800));
        assert.equal(await autoRouter.getUnderlyingStaked(), ether(7200));
        assert.equal(await autoRouter.getUnderlyingOnAutoFarm(), ether(12000));
        assert.equal(await autoRouter.getPendingRewards(), ether(4800));
        assert.equal(await autoRouter.getAutoForShares(ether(3160)), ether(5056));
      });
    });

    it('should revert rebalancing if the staking address is 0', async () => {
      await time.increase(time.duration.weeks(1));
      await autoRouter.redeem(ether(8000), { from: piGov });
      await autoRouter.setVotingAndStaking(autoFarm.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await auto.balanceOf(autoStrategy.address), ether(42000));
      assert.equal(await auto.balanceOf(piAuto.address), ether(10000));
      assert.equal(await piAuto.balanceOf(alice), ether(10000));
      assert.equal(await piAuto.totalSupply(), ether(10000));

      await piAuto.withdraw(ether(1000), { from: alice });

      await expectRevert(autoRouter.poke(false, { from: bob }), 'STAKING_IS_NULL');

      assert.equal(await auto.balanceOf(autoStrategy.address), ether(42000));
      assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(0));
      assert.equal(await auto.balanceOf(piAuto.address), ether(9000));
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await time.increase(time.duration.weeks(1));
        await autoRouter.setReserveConfig(ether('0.2'), time.duration.hours(1), { from: piGov });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2));
        await autoRouter.poke(false, { from: bob });
      });

      it('should DO rebalance on deposit if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await auto.approve(piAuto.address, ether(1000), { from: alice });
        await piAuto.deposit(ether(1000), { from: alice });
        await autoRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await auto.balanceOf(autoStrategy.address), ether(50800));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(8800));
        assert.equal(await auto.balanceOf(piAuto.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piAuto.withdraw(ether(1000), { from: alice });
        await autoRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await auto.balanceOf(autoStrategy.address), ether(49200));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(7200));
        assert.equal(await auto.balanceOf(piAuto.address), ether(1800));
      });

      it('should NOT rebalance if the rebalancing interval hasn\'t passed', async () => {
        await time.increase(time.duration.minutes(59));

        await auto.approve(piAuto.address, ether(1000), { from: alice });
        await piAuto.deposit(ether(1000), { from: alice });

        assert.equal(await autoRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), false);
        await expectRevert(autoRouter.pokeFromReporter('0', false, '0x', { from: bob }), 'MIN_INTERVAL_NOT_REACHED');

        await time.increase(60);

        await autoRouter.pokeFromReporter('0', false, '0x', { from: bob });
      });

      it('should rebalance if the rebalancing interval not passed but reserveRatioToForceRebalance has reached', async () => {
        await time.increase(time.duration.minutes(59));

        assert.equal(await autoRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), false);
        await piAuto.withdraw(ether(2000), { from: alice });
        assert.equal(await autoRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), true);
        await autoRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await auto.balanceOf(autoStrategy.address), ether(48400));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(6400));
        assert.equal(await auto.balanceOf(piAuto.address), ether(1600));
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await autoRouter.poke(false, { from: bob });

        assert.equal(await auto.balanceOf(autoStrategy.address), ether(50000));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(8000));
        assert.equal(await auto.balanceOf(piAuto.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await auto.transfer(piAuto.address, ether(1000), { from: alice });

        assert.equal(await auto.balanceOf(autoStrategy.address), ether(50000));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(8000));
        assert.equal(await auto.balanceOf(piAuto.address), ether(3000));
        assert.equal(await piAuto.totalSupply(), ether(10000));
        assert.equal(await autoRouter.getUnderlyingStaked(), ether(7000));
        assert.equal(await autoRouter.getUnderlyingOnAutoFarm(), ether(8000));
        assert.equal(await autoRouter.getPendingRewards(), ether(1000));

        await autoRouter.poke(false, { from: bob });

        assert.equal(await auto.balanceOf(autoStrategy.address), ether(51000));
        assert.equal(await autoFarm.stakedWantTokens(0, piAuto.address), ether(9000));
        assert.equal(await auto.balanceOf(piAuto.address), ether(2000));
        assert.equal(await piAuto.totalSupply(), ether(10000));
        assert.equal(await autoRouter.getUnderlyingStaked(), ether(8000));
        assert.equal(await autoRouter.getUnderlyingOnAutoFarm(), ether(9000));
        assert.equal(await autoRouter.getPendingRewards(), ether(1000));
      });
    });

    it('should stake all the underlying tokens with 0 RR', async () => {
      await autoRouter.setReserveConfig(ether(0), 0, { from: piGov });

      await autoRouter.poke(false, { from: bob });
      assert.equal(await auto.balanceOf(autoStrategy.address), ether(52000));
      assert.equal(await auto.balanceOf(piAuto.address), ether(0));
    })

    it('should keep all the underlying tokens on piToken with 1 RR', async () => {
      await autoRouter.setReserveConfig(ether(1), 0, { from: piGov });
      await time.increase(time.duration.weeks(1));

      await autoRouter.poke(false, { from: bob });
      assert.equal(await auto.balanceOf(autoStrategy.address), ether(42000));
      assert.equal(await auto.balanceOf(piAuto.address), ether(10000));
    })
  });

  describe('reward distribution', async () => {
    let poolA, poolB, poolC, poolD;

    beforeEach(async function () {
      poolA = await MockGulpingBPool.new();
      poolB = await MockGulpingBPool.new();
      poolC = await MockGulpingBPool.new();
      poolD = await MockGulpingBPool.new();
      await autoRouter.setRewardPools([poolA.address, poolB.address, poolC.address], { from: piGov });

      await poolRestrictions.setVotingAllowedForSenders(autoFarm.address, [alice], [true]);

      await auto.transfer(alice, ether('10000'));
      await auto.approve(piAuto.address, ether('10000'), { from: alice });
      await piAuto.deposit(ether('10000'), { from: alice });

      await autoRouter.poke(false);
      await autoStrategy.earn({ from: autoOwner });

      assert.equal(await piAuto.totalSupply(), ether('10000'));
      assert.equal(await piAuto.balanceOf(alice), ether('10000'));
      assert.equal(await autoStrategy.sharesTotal(), ether(50000));
      assert.equal(await autoStrategy.wantLockedTotal(), ether(50000));

      await piAuto.transfer(poolA.address, 10, { from: alice });
      await piAuto.transfer(poolB.address, 20, { from: alice });
    });

    it('should allow withdrawing rewards from the governance', async () => {
      await auto.transfer(autoStrategy.address, ether(2000));
      await autoStrategy.earn({ from: autoOwner });

      await time.increase(time.duration.days(8));
      assert.equal(await auto.balanceOf(piAuto.address), ether(2000));
      assert.equal(await autoRouter.getUnderlyingStaked(), ether(8000));
      assert.equal(await autoRouter.getUnderlyingOnAutoFarm(), ether(8320));
      assert.equal(await autoRouter.getPendingRewards(), ether(320));
      assert.equal(await autoRouter.getAutoForShares(ether(320)), ether('332.8'));

      let res = await autoRouter.poke(true, { from: bob });
      expectEvent(res, 'ClaimRewards', {
        sender: bob,
        expectedAutoReward: ether(320),
        releasedAutoReward: ether(320)
      })

      expectEvent(res, 'DistributeRewards', {
        sender: bob,
        autoReward: ether(320),
        pvpReward: ether(48),
        poolRewardsUnderlying: ether(272),
        poolRewardsPi: ether(272),
        pools: [poolA.address, poolB.address, poolC.address],
      });

      assert.equal(await auto.balanceOf(piAuto.address), addBN(ether(2000), ether(272)));
      assert.equal(await auto.balanceOf(autoRouter.address), '0');

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

      assert.equal(await piAuto.balanceOf(poolA.address), 90666666666666666666 + 10);
      assert.equal(await piAuto.balanceOf(poolB.address), 181333333333333333333 + 20);
      assert.equal(await piAuto.balanceOf(poolC.address), '0');
      assert.equal(await piAuto.balanceOf(poolD.address), '0');

      assert.equal(await auto.balanceOf(autoRouter.address), '0');
      assert.equal(await auto.balanceOf(autoRouter.address), '0');
    });

    it('should revert poke if there is no reward available', async () => {
      await expectRevert(autoRouter.poke(true, { from: alice }), 'NOTHING_TO_CLAIM');
    });

    it('should revert poke if there is nothing released', async () => {
      const scammyChef = await MockAutoMasterChef.new(auto.address, ether(8320));
      await autoRouter.setReserveConfig(ether(1), 0, { from: piGov });
      await time.increase(time.duration.weeks(1));
      await autoRouter.poke(false);
      await autoRouter.setVotingAndStaking(constants.ZERO_ADDRESS, scammyChef.address, { from: piGov });
      await autoRouter.setReserveConfig(ether('0.2'), 0, { from: piGov });
      await autoRouter.poke(false);
      await auto.transfer(scammyChef.address, ether(1000));
      await expectRevert(autoRouter.poke(true, { from: alice }), 'NOTHING_RELEASED');
    });

    it('should revert distributing rewards when missing reward pools config', async () => {
      poke = await MockPoke.new(true);
      const router = await AutoPowerIndexRouter.new(
        piAuto.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          autoFarm.address,
          autoFarm.address,
          ether('0.2'),
          ether('0.02'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildAutoRouterConfig(
          auto.address
        ),
      );
      await autoRouter.migrateToNewRouter(piAuto.address, router.address, [], { from: piGov });
      await auto.transfer(autoStrategy.address, ether(2000));
      await autoStrategy.earn({ from: autoOwner });
      await time.increase(time.duration.weeks(1));
      await expectRevert(router.poke(true, { from: bob }), 'MISSING_REWARD_POOLS');
    });
  });
});
