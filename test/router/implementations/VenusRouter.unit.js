const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, addBN, artifactFromBytecode, newCompContract, attachCompContract } = require('../../helpers');
const { buildBasicRouterConfig, buildVenusRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const VenusVBep20SupplyRouter = artifacts.require('VenusVBep20SupplyRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const SushiBar = artifacts.require('SushiBar');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const MockPoke = artifacts.require('MockPoke');
const MockOracle = artifacts.require('MockOracle');

MockERC20.numberFormat = 'String';
VenusVBep20SupplyRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
SushiBar.numberFormat = 'String';

const Unitroller = artifactFromBytecode('bsc/Unitroller');
const ComptrollerV1 = artifactFromBytecode('bsc/ComptrollerV1');
const VBep20Delegate = artifactFromBytecode('bsc/VBep20Delegate');
const VBep20Delegator = artifactFromBytecode('bsc/VBep20Delegator');
const WhitePaperInterestRateModel = artifactFromBytecode('bsc/WhitePaperInterestRateModel');

const { web3 } = MockERC20;

const REPORTER_ID = 42;

describe('VenusRouter Tests', () => {
  let bob, alice, charlie, venusOwner, piGov, stub, pvp, pool1, pool2;

  before(async function() {
    [, bob, alice, charlie, venusOwner, piGov, stub, pvp, pool1, pool2] = await web3.eth.getAccounts();
  });

  let trollerV4, oracle, usdc, xvs, vUsdc, interestRateModel, poolRestrictions, piUsdc, venusRouter, poke, cake, vCake;

  beforeEach(async function() {
    // bsc: 0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63
    xvs = await MockERC20.new('Venus', 'XVS', '18', ether(1e14));

    // bsc: 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
    usdc = await MockERC20.new('USD Coin', 'USDC', 18, ether('10000000'));
    cake = await MockERC20.new('Pancake', 'CAKE', 18, ether('10000000'));

    // bsc: 0x9e47c4f8654edfb45bc81e7e320c8fc1ad0acb73
    interestRateModel = await WhitePaperInterestRateModel.new(
      // baseRatePerYear
      0,
      // multiplierPerYear
      ether('90'),
    );

    // bsc: 0xd8b6da2bfec71d684d3e2a2fc9492ddad5c3787f
    oracle = await MockOracle.new();
    const replacement = xvs.address.substring(2).toLowerCase();
    const ComptrollerV4 = artifactFromBytecode('bsc/ComptrollerV4', [
      { substr: 'cf6bb5389c92bdda8a3747ddb454cb7a64626c63', newSubstr: replacement },
    ]);

    // bsc: 0xfD36E2c2a6789Db23113685031d7F16329158384 -> (0xba469fba7ea40d237b92bf30625513700f0afa47:V4)
    const comptrollerV1 = await ComptrollerV1.new();
    const comptrollerV4 = await ComptrollerV4.new();
    const unitroller = await newCompContract(Unitroller);
    const trollerV3 = await attachCompContract(ComptrollerV1, unitroller.address);
    trollerV4 = await attachCompContract(ComptrollerV4, unitroller.address);

    // bump to V1
    await unitroller._setPendingImplementation(comptrollerV1.address);
    await comptrollerV1._become(unitroller.address);

    // bsc: 0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8
    const vUsdcImpl = await VBep20Delegate.new();
    vUsdc = await newCompContract(
      VBep20Delegator,
      // address underlying_,
      usdc.address,
      // ComptrollerInterface comptroller_,
      unitroller.address,
      // InterestRateModel interestRateModel_,
      interestRateModel.address,
      // uint initialExchangeRateMantissa_,
      ether(1),
      // string memory name_,
      'Venus USDC',
      // string memory symbol_,
      'vUSDC',
      // uint8 decimals_,
      8,
      // address payable admin_,
      venusOwner,
      // address implementation_,
      vUsdcImpl.address,
      // bytes memory becomeImplementationData
      '0x',
    );
    vCake = await newCompContract(
      VBep20Delegator,
      // address underlying_,
      cake.address,
      // ComptrollerInterface comptroller_,
      unitroller.address,
      // InterestRateModel interestRateModel_,
      interestRateModel.address,
      // uint initialExchangeRateMantissa_,
      ether(1),
      // string memory name_,
      'Venus CAKE',
      // string memory symbol_,
      'vCAKE',
      // uint8 decimals_,
      8,
      // address payable admin_,
      venusOwner,
      // address implementation_,
      vUsdcImpl.address,
      // bytes memory becomeImplementationData
      '0x',
    );

    poolRestrictions = await PoolRestrictions.new();
    piUsdc = await WrappedPiErc20.new(usdc.address, stub, 'Wrapped USDC', 'piUSDC');
    poke = await MockPoke.new(true);
    venusRouter = await VenusVBep20SupplyRouter.new(
      piUsdc.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        vUsdc.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
      buildVenusRouterConfig(unitroller.address, xvs.address),
    );

    await piUsdc.changeRouter(venusRouter.address, { from: stub });

    await oracle.setPrice(usdc.address, ether(1));
    await oracle.setPrice(cake.address, ether(20));
    await oracle.setWrapper(vUsdc.address, usdc.address);
    await oracle.setWrapper(vCake.address, cake.address);

    await trollerV3._setPriceOracle(oracle.address);
    await trollerV3._supportMarket(vUsdc.address);
    await trollerV3._supportMarket(vCake.address);
    await trollerV3._setVenusRate(ether(600000));
    await trollerV3._setMaxAssets(10);
    await trollerV3._addVenusMarkets([vUsdc.address]);
    await trollerV3._setCollateralFactor(vUsdc.address, ether(0.8));
    await trollerV3._setCollateralFactor(vCake.address, ether(0.8));

    await trollerV3.enterMarkets([vUsdc.address, vCake.address], { from: bob });
    await trollerV3.enterMarkets([vUsdc.address, vCake.address], { from: charlie });

    // bump to V4
    await unitroller._setPendingImplementation(comptrollerV4.address);
    await comptrollerV4._become(unitroller.address);
    await trollerV4._setVenusSpeed(vUsdc.address, ether(300000));

    await venusRouter.initRouter();

    await usdc.transfer(bob, ether(42000));
    await usdc.approve(vUsdc.address, ether(42000), { from: bob });
    await vUsdc.mint(ether(42000), { from: bob });

    await cake.transfer(charlie, ether(5000));
    await cake.approve(vCake.address, ether(5000), { from: charlie });
    await vCake.mint(ether(5000), { from: charlie });

    await venusRouter.transferOwnership(piGov);

    assert.equal(await venusRouter.owner(), piGov);
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await venusRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await usdc.transfer(alice, ether('10000'));
        await usdc.approve(piUsdc.address, ether('10000'), { from: alice });
        await piUsdc.deposit(ether('10000'), { from: alice });

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await venusRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await usdc.balanceOf(piUsdc.address), ether(0));
          assert.equal(await usdc.balanceOf(vUsdc.address), ether(52000));
          assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(10000));
        });

        it('should deny staking 0', async () => {
          await expectRevert(venusRouter.stake(ether(0), { from: piGov }), 'CANT_STAKE_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(venusRouter.stake(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await venusRouter.redeem(ether(3000), { from: piGov });
          expectEvent(res, 'Redeem', {
            sender: piGov,
            amount: ether(3000),
          });
          assert.equal(await usdc.balanceOf(piUsdc.address), ether(5000));
          assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(5000));
          assert.equal(await usdc.balanceOf(vUsdc.address), ether(47000));
        });

        it('should deny redeeming 0', async () => {
          await expectRevert(venusRouter.redeem(ether(0), { from: piGov }), 'CANT_REDEEM_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(venusRouter.redeem(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      });
    });

    describe('setRewardPools()', () => {
      it('should allow the owner setting a new reward pool', async () => {
        const res = await venusRouter.setRewardPools([alice, bob], { from: piGov });
        expectEvent(res, 'SetRewardPools', {
          len: '2',
          rewardPools: [alice, bob],
        });
      });

      it('should deny setting an empty reward pool', async () => {
        await expectRevert(venusRouter.setRewardPools([], { from: piGov }), 'AT_LEAST_ONE_EXPECTED');
      });

      it('should deny non-owner setting a new reward pool', async () => {
        await expectRevert(
          venusRouter.setRewardPools([alice, bob], { from: alice }),
          'Ownable: caller is not the owner',
        );
      });
    });

    describe('setPvpFee()', () => {
      it('should allow the owner setting a new pvpFee', async () => {
        const res = await venusRouter.setPvpFee(ether('0.1'), { from: piGov });
        expectEvent(res, 'SetPvpFee', {
          pvpFee: ether('0.1'),
        });
      });

      it('should deny setting a fee greater or equal 100%', async () => {
        await expectRevert(venusRouter.setPvpFee(ether('1'), { from: piGov }), 'PVP_FEE_OVER_THE_LIMIT');
      });

      it('should deny non-owner setting a new pvpFee', async () => {
        await expectRevert(venusRouter.setPvpFee(ether('0'), { from: alice }), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('viewers', () => {
    it('should return the same amount for getPiEquivalentForUnderlying()', async () => {
      assert.equal(await venusRouter.getPiEquivalentForUnderlying(123, alice, 789), 123);
    });

    it('should return the same amount for getUnderlyingEquivalentForPi()', async () => {
      assert.equal(await venusRouter.getUnderlyingEquivalentForPi(123, alice, 789), 123);
    });

    it('should return the same amount for getPiEquivalentForUnderlyingPure()', async () => {
      assert.equal(await venusRouter.getPiEquivalentForUnderlyingPure(123, 456, 789), 123);
    });

    it('should return the same amount for getUnderlyingEquivalentForPiPure()', async () => {
      assert.equal(await venusRouter.getUnderlyingEquivalentForPiPure(123, 456, 789), 123);
    });
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      await usdc.transfer(alice, ether(100000));
      await usdc.approve(piUsdc.address, ether(10000), { from: alice });
      await piUsdc.deposit(ether(10000), { from: alice });

      await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
      assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
    });

    describe('non-modified vToken ratio', () => {
      it('should increase reserve on deposit', async () => {
        assert.equal(await piUsdc.balanceOf(alice), ether(10000));
        await usdc.approve(piUsdc.address, ether(1000), { from: alice });
        await piUsdc.deposit(ether(1000), { from: alice });

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await piUsdc.balanceOf(alice), ether(11000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50800));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8800));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2200));
      });

      it('should decrease reserve on withdrawal', async () => {
        assert.equal(await piUsdc.balanceOf(alice), ether(10000));

        await piUsdc.withdraw(ether(1000), { from: alice });

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await piUsdc.balanceOf(alice), ether(9000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(49200));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(7200));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(1800));
      });
    });

    describe('modified vToken ratio', () => {
      beforeEach(async () => {
        assert.equal(await piUsdc.balanceOf(alice), ether(10000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
        assert.equal(await venusRouter.getTokenForVToken(ether(3160)), ether(3160));

        await time.advanceBlock(1000);
        await usdc.transfer(vUsdc.address, ether(30000));
        await time.advanceBlock(1000);
        await time.increase(time.duration.years(2));
        await vUsdc.accrueInterest();

        assert.equal(await piUsdc.balanceOf(alice), ether(10000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(80000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(8000));
        assert.equal(await venusRouter.getTokenForVToken(ether(2000)), ether(3200));
        assert.equal(await venusRouter.getUnderlyingBackedByVToken(), ether(12800));
      });

      it('should mint a smaller amount of vToken', async () => {
        await usdc.approve(piUsdc.address, ether(1000), { from: alice });
        await piUsdc.deposit(ether(1000), { from: alice });

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await piUsdc.balanceOf(alice), ether(11000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(80800));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8500));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2200));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(8800));
        assert.equal(await venusRouter.getUnderlyingBackedByVToken(), ether(13600));
        assert.equal(await venusRouter.getPendingInterestReward(), addBN(ether(4800), '1'));
        assert.equal(await venusRouter.getTokenForVToken(ether(3160)), ether(5056));
      });

      it('should decrease reserve on withdrawal', async () => {
        await piUsdc.withdraw(ether(1000), { from: alice });

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await piUsdc.balanceOf(alice), ether(9000));
        assert.equal(await usdc.balanceOf(vUsdc.address), ether(79200));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(7500));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(1800));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(7200));
        assert.equal(await venusRouter.getUnderlyingBackedByVToken(), ether(12000));
        assert.equal(await venusRouter.getPendingInterestReward(), addBN(ether(4800), '1'));
        assert.equal(await venusRouter.getTokenForVToken(ether(3160)), ether(5056));
      });
    });

    it('should revert rebalancing if the staking address is 0', async () => {
      await venusRouter.redeem(ether(8000), { from: piGov });
      await venusRouter.setVotingAndStaking(vUsdc.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await usdc.balanceOf(vUsdc.address), ether(42000));
      assert.equal(await usdc.balanceOf(piUsdc.address), ether(10000));
      assert.equal(await piUsdc.balanceOf(alice), ether(10000));
      assert.equal(await piUsdc.totalSupply(), ether(10000));

      await piUsdc.withdraw(ether(1000), { from: alice });

      await expectRevert(venusRouter.pokeFromReporter(REPORTER_ID, false, '0x'), 'STAKING_IS_NULL');

      assert.equal(await usdc.balanceOf(vUsdc.address), ether(42000));
      assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(0));
      assert.equal(await usdc.balanceOf(piUsdc.address), ether(9000));
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await venusRouter.setReserveConfig(ether('0.2'), ether('0.02'), ether('0.3'), time.duration.hours(1), { from: piGov });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2));
        await time.increase(time.duration.minutes(61));
        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      });

      it('should DO rebalance on deposit if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await usdc.approve(piUsdc.address, ether(1000), { from: alice });
        await piUsdc.deposit(ether(1000), { from: alice });
        await venusRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50800));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8800));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piUsdc.withdraw(ether(1000), { from: alice });
        await venusRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(49200));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(7200));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(1800));
      });

      it("should NOT rebalance if the rebalancing interval hasn't passed", async () => {
        await time.increase(time.duration.minutes(59));

        await usdc.approve(piUsdc.address, ether(1000), { from: alice });
        await piUsdc.deposit(ether(1000), { from: alice });

        assert.equal(await venusRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), false);
        await expectRevert(venusRouter.pokeFromReporter('0', false, '0x', { from: bob }), 'MIN_INTERVAL_NOT_REACHED');

        await time.increase(60);

        await venusRouter.pokeFromReporter('0', false, '0x', { from: bob });
      });

      it('should rebalance if the rebalancing interval not passed but reserveRatioToForceRebalance has reached', async () => {
        await time.increase(time.duration.minutes(59));

        assert.equal(await venusRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), false);
        await piUsdc.withdraw(ether(2000), { from: alice });
        assert.equal(await venusRouter.getReserveStatusForStakedBalance().then(s => s.forceRebalance), true);
        await venusRouter.pokeFromReporter('0', false, '0x', { from: bob });

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(48400));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(6400));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(1600));
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await usdc.transfer(piUsdc.address, ether(1000), { from: alice });

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(8000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(3000));
        assert.equal(await piUsdc.totalSupply(), ether(10000));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(7000));
        assert.equal(await venusRouter.getUnderlyingBackedByVToken(), ether(8000));
        assert.equal(await venusRouter.getPendingInterestReward(), addBN(ether(1000), '1'));

        await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

        assert.equal(await usdc.balanceOf(vUsdc.address), ether(51000));
        assert.equal(await vUsdc.balanceOf(piUsdc.address), ether(9000));
        assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
        assert.equal(await piUsdc.totalSupply(), ether(10000));
        assert.equal(await venusRouter.getUnderlyingStaked(), ether(8000));
        assert.equal(await venusRouter.getUnderlyingBackedByVToken(), ether(9000));
        assert.equal(await venusRouter.getPendingInterestReward(), addBN(ether(1000), '1'));
      });
    });

    it('should stake all the underlying tokens with 0 RR', async () => {
      await venusRouter.setReserveConfig(ether(0), ether(0), ether(1), 0, { from: piGov });

      await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      assert.equal(await usdc.balanceOf(vUsdc.address), ether(52000));
      assert.equal(await usdc.balanceOf(piUsdc.address), ether(0));
    });

    it('should keep all the underlying tokens on piToken with 1 RR', async () => {
      await venusRouter.setReserveConfig(ether(1), ether(0), ether(1), 0, { from: piGov });

      await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');
      assert.equal(await usdc.balanceOf(vUsdc.address), ether(42000));
      assert.equal(await usdc.balanceOf(piUsdc.address), ether(10000));
    });
  });

  describe('reward distribution', async () => {
    let poolA, poolB, poolC, poolD;

    beforeEach(async function() {
      poolA = await MockGulpingBPool.new();
      poolB = await MockGulpingBPool.new();
      poolC = await MockGulpingBPool.new();
      poolD = await MockGulpingBPool.new();
      await venusRouter.setRewardPools([poolA.address, poolB.address, poolC.address], { from: piGov });

      await poolRestrictions.setVotingAllowedForSenders(vUsdc.address, [alice], [true]);

      await usdc.transfer(alice, ether('10000'));
      await usdc.approve(piUsdc.address, ether('10000'), { from: alice });
      await piUsdc.deposit(ether('10000'), { from: alice });

      await venusRouter.pokeFromReporter(REPORTER_ID, false, '0x');

      assert.equal(await piUsdc.totalSupply(), ether('10000'));
      assert.equal(await piUsdc.balanceOf(alice), ether('10000'));
      assert.equal(await vUsdc.totalSupply(), ether(50000));
      assert.equal(await usdc.balanceOf(vUsdc.address), ether(50000));

      await piUsdc.transfer(poolA.address, 10, { from: alice });
      await piUsdc.transfer(poolB.address, 20, { from: alice });
    });

    it('should allow withdrawing interest rewards from a vToken only', async () => {
      await usdc.transfer(vUsdc.address, ether(2000));
      await vUsdc.accrueInterest();

      assert.equal(await vUsdc.totalSupply(), ether(50000));
      assert.equal(await usdc.balanceOf(vUsdc.address), ether(52000));

      assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
      assert.equal(await venusRouter.getUnderlyingStaked(), ether(8000));
      assert.equal(await venusRouter.getUnderlyingBackedByVToken(), ether(8320));
      assert.equal(await venusRouter.getPendingInterestReward(), addBN(ether(320), '1'));
      assert.equal(await venusRouter.getVTokenForToken(ether(320)), '307692307692307692307');

      let res = await venusRouter.pokeFromReporter(REPORTER_ID, true, '0x', { from: bob });
      expectEvent(res, 'ClaimRewards', {
        sender: bob,
        xvsEarned: ether(0),
        underlyingEarned: addBN(ether(320), '1'),
      });

      expectEvent(res, 'DistributeUnderlyingReward', {
        sender: bob,
        underlyingReward: ether('320.000000000000000001'),
        pvpReward: ether(48),
        poolRewardsUnderlying: ether('272.000000000000000001'),
        poolRewardsPi: ether('272.000000000000000001'),
        pools: [poolA.address, poolB.address, poolC.address],
      });

      assert.equal(await usdc.balanceOf(piUsdc.address), addBN(ether(2000), ether('272.000000000000000001')));
      assert.equal(await usdc.balanceOf(venusRouter.address), '0');

      assert.isTrue(parseInt(res.logs[3].args.poolRewardsUnderlying) > 1);
      assert.isTrue(parseInt(res.logs[3].args.poolRewardsPi.length) > 1);

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 4);
      assert.equal(res.logs[1].args.pool, poolA.address);
      assert.equal(res.logs[1].args.amount, '90666666666666666667');
      assert.equal(res.logs[2].args.pool, poolB.address);
      assert.equal(res.logs[2].args.amount, '181333333333333333334');

      assert.equal(await piUsdc.balanceOf(poolA.address), 90666666666666666666 + 10);
      assert.equal(await piUsdc.balanceOf(poolB.address), 181333333333333333333 + 20);
      assert.equal(await piUsdc.balanceOf(poolC.address), '0');
      assert.equal(await piUsdc.balanceOf(poolD.address), '0');

      assert.equal(await usdc.balanceOf(venusRouter.address), '0');
    });

    it.skip('should keep XVS on the contract in the case with the UNDERLYING is different', async () => {
      assert.equal(await piUsdc.balanceOf(poolA.address), 10);
      assert.equal(await piUsdc.balanceOf(poolB.address), 20);

      await vUsdc.borrow(ether(21000), { from: charlie });

      await xvs.transfer(trollerV4.address, ether(100000000));
      await time.advanceBlock(200);

      assert.equal(await vUsdc.totalSupply(), ether(50000));
      assert.equal(await usdc.balanceOf(vUsdc.address), ether(29000));

      assert.equal(await usdc.balanceOf(piUsdc.address), ether(2000));
      assert.equal(await venusRouter.getUnderlyingStaked(), ether(8000));
      assert.equal(await venusRouter.getUnderlyingBackedByVToken(), ether(8000));
      assert.equal(await venusRouter.getPendingInterestReward(), ether(0));
      assert.equal(await venusRouter.getVTokenForToken(ether(320)), ether(320));

      let res = await venusRouter.pokeFromReporter(REPORTER_ID, true, '0x', { from: bob });
      expectEvent(res, 'ClaimRewards', {
        sender: bob,
        xvsEarned: ether(288000),
      });

      expectEvent(res, 'DistributeUnderlyingReward', {
        sender: bob,
        underlyingReward: ether('0.036246575342456001'),
        pvpReward: ether('0.005436986301368400'),
        poolRewardsUnderlying: ether('0.030809589041087601'),
        poolRewardsPi: ether('0.030809589041087601'),
        pools: [poolA.address, poolB.address, poolC.address],
      });

      assert.equal(await usdc.balanceOf(piUsdc.address), addBN(ether(2000), ether('0.030809589041087601')));
      assert.equal(await usdc.balanceOf(venusRouter.address), '0');
      assert.equal(await xvs.balanceOf(venusRouter.address), ether('288000'));

      assert.isTrue(parseInt(res.logs[3].args.poolRewardsUnderlying) > 1);
      assert.isTrue(parseInt(res.logs[3].args.poolRewardsPi.length) > 1);

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 4);
      assert.equal(res.logs[1].args.pool, poolA.address);
      assert.equal(res.logs[1].args.amount, '10269863013695867');
      assert.equal(res.logs[2].args.pool, poolB.address);
      assert.equal(res.logs[2].args.amount, '20539726027391734');

      assert.equal(await piUsdc.balanceOf(poolA.address), '10269863013695877');
      assert.equal(await piUsdc.balanceOf(poolB.address), ether('0.020539726027391754'));
      assert.equal(await piUsdc.balanceOf(poolC.address), '0');
      assert.equal(await piUsdc.balanceOf(poolD.address), '0');

      assert.equal(await usdc.balanceOf(venusRouter.address), '0');
      assert.equal(await usdc.balanceOf(venusRouter.address), '0');
    });

    it('should revert poke if there is no reward available', async () => {
      await expectRevert(venusRouter.pokeFromReporter(REPORTER_ID, true, '0x'), 'NOTHING_TO_DISTRIBUTE');
    });

    it('should revert distributing rewards when missing reward pools config', async () => {
      poke = await MockPoke.new(true);
      const router = await VenusVBep20SupplyRouter.new(
        piUsdc.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          vUsdc.address,
          vUsdc.address,
          ether('0.2'),
          ether('0.02'),
          ether('0.2'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildVenusRouterConfig(trollerV4.address, usdc.address),
      );
      await venusRouter.migrateToNewRouter(piUsdc.address, router.address, [usdc.address, piUsdc.address], {
        from: piGov,
      });
      await usdc.transfer(vUsdc.address, ether(2000));
      await time.increase(1);
      await expectRevert(router.pokeFromReporter(REPORTER_ID, true, '0x'), 'MISSING_REWARD_POOLS');
    });
  });
});
