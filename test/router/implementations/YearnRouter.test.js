const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, mwei, getResTimestamp } = require('../../helpers');
const { buildBasicRouterConfig, buildYearnRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const YearnPowerIndexRouter = artifacts.require('YearnPowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockYearnGovernance = artifacts.require('MockYearnGovernance');
const MockYDeposit = artifacts.require('MockYDeposit');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
const MockWETH = artifacts.require('MockWETH');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const MockPoke = artifacts.require('MockPoke');

MockERC20.numberFormat = 'String';
YearnPowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
MockYearnGovernance.numberFormat = 'String';

const { web3 } = MockERC20;

async function buildUniswapPair(weth, yfi, usdc, lpTokensTo) {
  const factory = await UniswapV2Factory.new(lpTokensTo);
  const router = await UniswapV2Router02.new(factory.address, weth.address);
  const deadline = (await time.latest()).add(time.duration.days(1)).toString();

  // YFI
  const yfiAmount = ether(1e6);
  await yfi.approve(router.address, yfiAmount);
  await router.addLiquidityETH(yfi.address, yfiAmount, ether(1), ether(1), lpTokensTo, deadline, {
    value: ether(1666),
  });

  // USDC
  const usdcAmount = mwei(1e6);
  await usdc.approve(router.address, usdcAmount);
  await router.addLiquidityETH(usdc.address, usdcAmount, ether(1), ether(1), lpTokensTo, deadline, {
    value: ether(1666),
  });

  return router;
}

describe('YearnRouter Tests', () => {
  let bob, alice, yearnOwner, piGov, stub, pvp, pool1, pool2, rewardDistributor;

  before(async function () {
    [, bob, alice, yearnOwner, piGov, stub, pvp, pool1, pool2, rewardDistributor] = await web3.eth.getAccounts();
  });

  let yfi, yCrv, usdc, weth, yDeposit, yearnGovernance, poolRestrictions, piYfi, yfiRouter, poke;

  beforeEach(async function () {
    // 0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e
    yfi = await MockERC20.new('yearn.finance', 'YFI', '18', ether('10000000'));
    // 0xdF5e0e81Dff6FAF3A7e52BA697820c5e32D806A8
    yCrv = await MockERC20.new('Curve.fi yDAI/yUSDC/yUSDT/yTUSD ', 'yDAI+yUSDC+yUSDT+yTUSD', '18', ether('10000000'));
    // 0xBa37B002AbaFDd8E89a1995dA52740bbC013D992
    yearnGovernance = await MockYearnGovernance.new();
    usdc = await MockERC20.new('USDC', 'USDC', '6', mwei('10000000'));
    weth = await MockWETH.new();
    // 0xbbc81d23ea2c3ec7e56d39296f0cbb648873a5d3
    yDeposit = await MockYDeposit.new(yCrv.address, usdc.address);

    poolRestrictions = await PoolRestrictions.new();
    piYfi = await WrappedPiErc20.new(yfi.address, stub, 'wrapped.yearn.finance', 'piYFI');
    poke = await MockPoke.new();
    yfiRouter = await YearnPowerIndexRouter.new(
      piYfi.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        yearnGovernance.address,
        yearnGovernance.address,
        ether('0.2'),
        ether('0.02'),
        '0',
        pvp,
        ether('0.15'),
        [pool1, pool2],
      ),
      buildYearnRouterConfig(
        yCrv.address,
        usdc.address,
        yfi.address,
        constants.ZERO_ADDRESS,
        yDeposit.address,
        [usdc.address, weth.address, yfi.address],
      ),
    );

    await piYfi.changeRouter(yfiRouter.address, { from: stub });

    await yfiRouter.transferOwnership(piGov);
    await yearnGovernance.transferOwnership(yearnOwner);

    await yearnGovernance.initialize(0, yearnOwner, yfi.address, yCrv.address);

    await yfi.transfer(yearnGovernance.address, ether(42000));

    assert.equal(await yfiRouter.owner(), piGov);

    // Hardcoded into the bytecode for the test sake
    assert.equal(await yearnGovernance.period(), 10);
    assert.equal(await yearnGovernance.lock(), 10);
  });

  describe('voting', async () => {
    const proposalString = 'Lets do it';

    beforeEach(async () => {
      await yfi.transfer(alice, ether('10000'));
      await yfi.approve(piYfi.address, ether('10000'), { from: alice });
      await piYfi.deposit(ether('10000'), { from: alice });
      await yfiRouter.poke(false);

      assert.equal(await piYfi.totalSupply(), ether('10000'));
      assert.equal(await piYfi.balanceOf(alice), ether('10000'));

      // The router has partially staked the deposit with regard to the reserve ration value (20/80)
      assert.equal(await yfi.balanceOf(piYfi.address), ether(2000));
      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50000));

      // The votes are allocated on the yfiWrapper contract
      assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(8000));

      await poolRestrictions.setVotingAllowedForSenders(yearnGovernance.address, [alice], [true]);

      await yfiRouter.callRegister({ from: alice });
      await yfiRouter.callPropose(bob, proposalString, { from: alice });
    });

    it('should allow creating a proposal in YearnGovernance and fot for it', async () => {
      await yfiRouter.callVoteFor(0, { from: alice });

      await time.advanceBlockTo((await time.latestBlock()).toNumber() + 10);

      await yearnGovernance.tallyVotes(0);

      const proposal = await yearnGovernance.proposals(0);
      assert.equal(proposal.open, false);
      assert.equal(proposal.totalForVotes, ether(8000));
      assert.equal(proposal.totalAgainstVotes, ether(0));
      assert.equal(proposal.hash, proposalString);
    });

    it('should allow creating a proposal in YearnGovernance and fot against it', async () => {
      await yfiRouter.callVoteAgainst(0, { from: alice });

      await time.advanceBlockTo((await time.latestBlock()).toNumber() + 10);

      await yearnGovernance.tallyVotes(0);

      const proposal = await yearnGovernance.proposals(0);
      assert.equal(proposal.open, false);
      assert.equal(proposal.totalForVotes, ether(0));
      assert.equal(proposal.totalAgainstVotes, ether(8000));
      assert.equal(proposal.hash, proposalString);
    });
  });

  describe('owner methods', async () => {
    beforeEach(async () => {
      await yfiRouter.transferOwnership(piGov, { from: piGov });
    });

    describe('stake()/redeem()', () => {
      beforeEach(async () => {
        await yfi.transfer(alice, ether('10000'));
        await yfi.approve(piYfi.address, ether('10000'), { from: alice });
        await piYfi.deposit(ether('10000'), { from: alice });
        await yfiRouter.poke(false);

        assert.equal(await yfi.balanceOf(piYfi.address), ether(2000));
        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50000));
        assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(8000));
      });

      describe('stake()', () => {
        it('should allow the owner staking any amount of reserve tokens', async () => {
          const res = await yfiRouter.stake(ether(2000), { from: piGov });
          expectEvent(res, 'Stake', {
            sender: piGov,
            amount: ether(2000),
          });
          assert.equal(await yfi.balanceOf(piYfi.address), ether(0));
          assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(52000));
          assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(10000));
        });

        it('should deny staking 0', async () => {
          await expectRevert(yfiRouter.stake(ether(0), { from: piGov }), 'CANT_STAKE_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(yfiRouter.stake(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      })

      describe('redeem()', () => {
        it('should allow the owner redeeming any amount of reserve tokens', async () => {
          const res = await yfiRouter.redeem(ether(3000), { from: piGov });
          expectEvent(res, 'Redeem', {
            sender: piGov,
            amount: ether(3000),
          });
          assert.equal(await yfi.balanceOf(piYfi.address), ether(5000));
          assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(5000));
          assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(47000));
        });

        it('should deny staking 0', async () => {
          await expectRevert(yfiRouter.redeem(ether(0), { from: piGov }), 'CANT_REDEEM_0');
        });

        it('should deny non-owner staking any amount of reserve tokens', async () => {
          await expectRevert(yfiRouter.redeem(ether(1), { from: alice }), 'Ownable: caller is not the owner');
        });
      })
    });

    describe('setRewardPools()', () => {
      it('should allow the owner setting a new reward pool', async () => {
        const res = await yfiRouter.setRewardPools([alice, bob], { from: piGov });
        expectEvent(res, 'SetRewardPools', {
          len: '2',
          rewardPools: [alice, bob],
        });
      });

      it('should deny setting an empty reward pool', async () => {
        await expectRevert(yfiRouter.setRewardPools([], { from: piGov }), 'AT_LEAST_ONE_EXPECTED');
      });

      it('should deny non-owner setting a new reward pool', async () => {
        await expectRevert(yfiRouter.setRewardPools([alice, bob], { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setPvpFee()', () => {
      it('should allow the owner setting a new pvpFee', async () => {
        const res = await yfiRouter.setPvpFee(ether('0.1'), { from: piGov });
        expectEvent(res, 'SetPvpFee', {
          pvpFee: ether('0.1'),
        });
      });

      it('should deny setting a fee greater or equal 100%', async () => {
        await expectRevert(yfiRouter.setPvpFee(ether('1'), { from: piGov }), 'PVP_FEE_OVER_THE_LIMIT');
      });

      it('should deny non-owner setting a new pvpFee', async () => {
        await expectRevert(yfiRouter.setPvpFee(ether('0'), { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setUniswapRouter()', () => {
      it('should allow the owner setting a new uniswap router', async () => {
        const res = await yfiRouter.setUniswapRouter(bob, { from: piGov });
        expectEvent(res, 'SetUniswapRouter', {
          uniswapRouter: bob,
        });
      });

      it('should deny non-owner setting a new uniswap router', async () => {
        await expectRevert(yfiRouter.setUniswapRouter(bob, { from: alice }), 'Ownable: caller is not the owner');
      });
    });

    describe('setUsdcYfiSwapPath()', () => {
      it('should allow the owner setting a new pvpFee', async () => {
        const res = await yfiRouter.setUsdcYfiSwapPath([usdc.address, yfi.address], { from: piGov });
        expectEvent(res, 'SetUsdcYfiSwapPath', {
          usdcYfiSwapPath: [usdc.address, yfi.address],
        });
      });

      it('should deny non-usdc first argument', async () => {
        await expectRevert(
          yfiRouter.setUsdcYfiSwapPath([alice, yfi.address], { from: alice }),
          'Ownable: caller is not the owner',
        );
      });


      it('should deny non-yfi last argument', async () => {
        await expectRevert(
          yfiRouter.setUsdcYfiSwapPath([usdc.address, alice], { from: alice }),
          'Ownable: caller is not the owner',
        );
      });

      it('should deny non-owner setting a new uniswap router', async () => {
        await expectRevert(
          yfiRouter.setUsdcYfiSwapPath([alice, bob], { from: alice }),
          'Ownable: caller is not the owner',
        );
      });
    });
  });

  describe('reserve management', () => {

    beforeEach(async () => {
      await yfi.transfer(alice, ether(100000));
      await yfi.approve(piYfi.address, ether(10000), { from: alice });
      const res = await piYfi.deposit(ether(10000), { from: alice });
      await yfiRouter.poke(false);
      await getResTimestamp(res);

      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50000));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(2000));
    });

    it('should increase reserve on deposit', async () => {
      assert.equal(await piYfi.balanceOf(alice), ether(10000));
      await yfi.approve(piYfi.address, ether(1000), { from: alice });
      await piYfi.deposit(ether(1000), { from: alice });
      await yfiRouter.poke(false);

      assert.equal(await piYfi.balanceOf(alice), ether(11000));
      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50800));
      assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(8800));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(2200));
      assert.equal(await yfiRouter.getUnderlyingStaked(), ether(8800));
    });

    it('should decrease reserve on withdrawal', async () => {
      assert.equal(await piYfi.balanceOf(alice), ether(10000));

      await piYfi.withdraw(ether(1000), { from: alice });
      await yfiRouter.poke(false);

      assert.equal(await piYfi.balanceOf(alice), ether(9000));
      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(49200));
      assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(7200));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(1800));
      assert.equal(await yfiRouter.getUnderlyingStaked(), ether(7200));
    });

    it('should ignore rebalancing if the staking address is 0', async () => {
      await yfiRouter.redeem(ether(8000), { from: piGov });
      await yfiRouter.setVotingAndStaking(yearnGovernance.address, constants.ZERO_ADDRESS, { from: piGov });

      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(42000));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(10000));
      assert.equal(await piYfi.balanceOf(alice), ether(10000));
      assert.equal(await piYfi.totalSupply(), ether(10000));
      await piYfi.withdraw(ether(1000), { from: alice });
      await expectRevert(yfiRouter.poke(false), 'STACKING_IS_NULL');
    });

    describe('when interval enabled', () => {
      beforeEach(async () => {
        await yfiRouter.setReserveConfig(ether('0.2'), time.duration.hours(1), { from: piGov });
        await poke.setMinMaxReportIntervals(time.duration.hours(1), time.duration.hours(2), { from: piGov });
      });

      it('should DO rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await yfi.approve(piYfi.address, ether(1000), { from: alice });
        await piYfi.deposit(ether(1000), { from: alice });
        await expectRevert(yfiRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should DO rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(121));

        await yfi.approve(piYfi.address, ether(1000), { from: alice });
        await piYfi.deposit(ether(1000), { from: alice });
        await yfiRouter.pokeFromSlasher(0, false, '0x');

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50800));
        assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(8800));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(2200));
      });

      it('should DO rebalance on withdrawal if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(61));

        await piYfi.withdraw(ether(1000), { from: alice });
        await yfiRouter.poke(false);

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(49200));
        assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(7200));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(1800));
      });

      it('should NOT rebalance by pokeFromReporter if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(50));

        await yfi.approve(piYfi.address, ether(1000), { from: alice });
        await piYfi.deposit(ether(1000), { from: alice });
        await expectRevert(yfiRouter.pokeFromReporter(0, false, '0x'), 'MIN_INTERVAL_NOT_REACHED');
        await expectRevert(yfiRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });

      it('should NOT rebalance by pokeFromSlasher if the rebalancing interval has passed', async () => {
        await time.increase(time.duration.minutes(70));

        await yfi.approve(piYfi.address, ether(1000), { from: alice });
        await piYfi.deposit(ether(1000), { from: alice });
        await expectRevert(yfiRouter.pokeFromSlasher(0, false, '0x'), 'MAX_INTERVAL_NOT_REACHED');
      });
    });

    describe('on vote lock', async () => {
      beforeEach(async () => {
        await poolRestrictions.setVotingAllowedForSenders(yearnGovernance.address, [piGov], [true]);

        await yfiRouter.callRegister({ from: piGov });
        await yfiRouter.callPropose(bob, 'buzz', { from: piGov });
        await yfiRouter.callVoteFor(0, { from: piGov });
      });

      it('should not decrease reserve if vote is locked', async () => {
        await piYfi.withdraw(ether(1000), { from: alice });
        await expectRevert(yfiRouter.poke(false), 'VOTE_LOCK');
      });

      it('should revert if there is not enough funds in reserve', async () => {
        await expectRevert(piYfi.withdraw(ether(3000), { from: alice }), 'ERC20: transfer amount exceeds balance');
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await yfiRouter.poke(false, { from: bob });

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50000));
        assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(8000));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await yfi.transfer(piYfi.address, ether(1000), { from: alice });

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50000));
        assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(8000));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(3000));

        await yfiRouter.poke(false, { from: bob });

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50800));
        assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(8800));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(2200));
      });
    });

    it('should stake all the underlying tokens with 0 RR', async () => {
      await yfiRouter.setReserveConfig(ether(0), 0, { from: piGov });

      await yfiRouter.poke(false, { from: bob });
      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(52000));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(0));
    })

    it('should keep all the underlying tokens on piToken with 1 RR', async () => {
      await yfiRouter.setReserveConfig(ether(1), 0, { from: piGov });

      await yfiRouter.poke(false, { from: bob });
      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(42000));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(10000));
    })
  });

  describe('reward distribution', async () => {
    let poolA, poolB, poolC, poolD;

    beforeEach(async function () {
      poolA = await MockGulpingBPool.new();
      poolB = await MockGulpingBPool.new();
      poolC = await MockGulpingBPool.new();
      poolD = await MockGulpingBPool.new();
      await yfiRouter.setRewardPools([poolA.address, poolB.address, poolC.address], { from: piGov });

      await usdc.transfer(yDeposit.address, mwei(10000));
      await yCrv.transfer(yDeposit.address, ether(10000));

      const uniswapRouter = await buildUniswapPair(weth, yfi, usdc, alice);
      await yfiRouter.setUniswapRouter(uniswapRouter.address, { from: piGov });

      await poolRestrictions.setVotingAllowedForSenders(yearnGovernance.address, [alice], [true]);

      await yCrv.transfer(rewardDistributor, ether('1000000'));
      await yfi.transfer(alice, ether('10000'));
      await yfi.approve(piYfi.address, ether('10000'), { from: alice });
      await piYfi.deposit(ether('10000'), { from: alice });
      await yfiRouter.poke(false);

      assert.equal(await piYfi.totalSupply(), ether('10000'));
      assert.equal(await piYfi.balanceOf(alice), ether('10000'));
      assert.equal(await yearnGovernance.totalSupply(), ether('8000'));

      await piYfi.transfer(poolA.address, 10, { from: alice });
      await piYfi.transfer(poolB.address, 20, { from: alice });

      await yearnGovernance.setRewardDistribution(rewardDistributor, { from: yearnOwner });
      await yearnGovernance.setBreaker(true, { from: yearnOwner });
      await yCrv.approve(yearnGovernance.address, ether(2000), { from: rewardDistributor });
    });

    it('should allow withdrawing rewards from the governance', async () => {
      await yearnGovernance.notifyRewardAmount(ether(2000), { from: rewardDistributor });

      await time.increase(time.duration.days(8));
      let res = await yfiRouter.poke(true, { from: bob });
      expectEvent(res, 'ClaimRewards', {
        sender: bob,
        yCrvAmount: '1999999999999999464000'
      })

      expectEvent(res, 'DistributeRewards', {
        sender: bob,
        yCrvReward: '1999999999999999464000',
        usdcConverted: '1799999999',
        yfiConverted: '1782826875172502033652',
        yfiGain: '1782826875172502033652',
        pvpReward: '267424031275875305047',
        poolRewardsUnderlying: '1515402843896626728605',
        poolRewardsPi: '1515402843896626728605',
        uniswapSwapPath: [usdc.address, weth.address, yfi.address],
        pools: [poolA.address, poolB.address, poolC.address],
      });

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 4);
      assert.equal(res.logs[1].args.pool, poolA.address);
      assert.equal(res.logs[1].args.amount, '505134281298875576201');
      assert.equal(res.logs[2].args.pool, poolB.address);
      assert.equal(res.logs[2].args.amount, '1010268562597751152403');

      assert.equal(await piYfi.balanceOf(poolA.address), 505134281298875576201 + 10);
      assert.equal(await piYfi.balanceOf(poolB.address), 1010268562597751152403 + 20);
      assert.equal(await piYfi.balanceOf(poolC.address), '0');
      assert.equal(await piYfi.balanceOf(poolD.address), '0');

      assert.equal(await yCrv.balanceOf(yfiRouter.address), '0');
      assert.equal(await usdc.balanceOf(yfiRouter.address), '0');
      assert.equal(await yfi.balanceOf(yfiRouter.address), '0');
    });

    it('should deny non-granted user calling exit() method', async () => {
      await expectRevert(yfiRouter.exit({ from: bob }), 'SENDER_NOT_ALLOWED');
    });

    it('should allow exiting from the governance (joint withdraw/getRewards action)', async () => {
      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(50000));
      assert.equal(await yearnGovernance.balanceOf(piYfi.address), ether(8000));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(2000));

      await yearnGovernance.notifyRewardAmount(ether(2000), { from: rewardDistributor });

      await time.increase(time.duration.days(8));
      let res = await yfiRouter.exit({ from: alice });
      expectEvent(res, 'Exit', {
        sender: alice,
        redeemAmount: ether('8000'),
        yCrvAmount: '1999999999999999464000'
      })

      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(42000));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(10000));
      assert.equal(await yCrv.balanceOf(yfiRouter.address), '1999999999999999464000');

      res = await yfiRouter.distributeRewards({ from: alice });

      expectEvent(res, 'DistributeRewards', {
        sender: alice,
        yCrvReward: '1999999999999999464000',
        usdcConverted: '1799999999',
        yfiConverted: '1782826875172502033652',
        yfiGain: '1782826875172502033652',
        pvpReward: '267424031275875305047',
        poolRewardsUnderlying: '1515402843896626728605',
        poolRewardsPi: '1515402843896626728605',
        uniswapSwapPath: [usdc.address, weth.address, yfi.address],
        pools: [poolA.address, poolB.address, poolC.address],
      });

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 3);
      assert.equal(res.logs[0].args.pool, poolA.address);
      assert.equal(res.logs[0].args.amount, '505134281298875576201');
      assert.equal(res.logs[1].args.pool, poolB.address);
      assert.equal(res.logs[1].args.amount, '1010268562597751152403');

      assert.equal(await piYfi.balanceOf(poolA.address), 505134281298875576201 + 10);
      assert.equal(await piYfi.balanceOf(poolB.address), 1010268562597751152403 + 20);
      assert.equal(await piYfi.balanceOf(poolC.address), '0');
      assert.equal(await piYfi.balanceOf(poolD.address), '0');

      assert.equal(await yCrv.balanceOf(yfiRouter.address), '0');
      assert.equal(await usdc.balanceOf(yfiRouter.address), '0');
      assert.equal(await yfi.balanceOf(yfiRouter.address), '0');
    });

    it('should revert distribute rewards() if there is no yCrv on the balance', async () => {
      await expectRevert(yfiRouter.poke(true, { from: bob }), 'NO_YCRV_REWARD_ON_PI');
    });

    it('should revert distributing rewards when missing reward pools config', async () => {
      poke = await MockPoke.new();
      const router = await YearnPowerIndexRouter.new(
        piYfi.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          yearnGovernance.address,
          yearnGovernance.address,
          ether('0.2'),
          ether('0.02'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildYearnRouterConfig(
          yCrv.address,
          usdc.address,
          yfi.address,
          constants.ZERO_ADDRESS,
          yDeposit.address,
          [usdc.address, weth.address, yfi.address],
        ),
      );
      await yfiRouter.migrateToNewRouter(piYfi.address, router.address, { from: piGov });
      await yearnGovernance.notifyRewardAmount(ether(2000), { from: rewardDistributor });
      await time.increase(1);
      await expectRevert(router.poke(true, { from: bob }), 'MISSING_REWARD_POOLS');
    });

    it('should revert when missing reward swap path', async () => {
      poke = await MockPoke.new();
      const router = await YearnPowerIndexRouter.new(
        piYfi.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          poke.address,
          yearnGovernance.address,
          yearnGovernance.address,
          ether('0.2'),
          ether('0.02'),
          '0',
          pvp,
          ether('0.2'),
          [pool1, pool2],
        ),
        buildYearnRouterConfig(
          yCrv.address,
          usdc.address,
          yfi.address,
          constants.ZERO_ADDRESS,
          yDeposit.address,
          [],
        ),
      );
      await yfiRouter.migrateToNewRouter(piYfi.address, router.address, { from: piGov });
      await yearnGovernance.notifyRewardAmount(ether(2000), { from: rewardDistributor });
      await time.increase(1);
      await expectRevert(router.poke(true, { from: bob }), 'MISSING_REWARD_SWAP_PATH');
    });
  });
});
