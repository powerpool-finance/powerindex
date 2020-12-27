const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether, mwei } = require('../../helpers');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const PowerIndexRouter = artifacts.require('YearnPowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockYearnGovernance = artifacts.require('MockYearnGovernance');
const MockYDeposit = artifacts.require('MockYDeposit');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
const MockWETH = artifacts.require('MockWETH');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');

MockERC20.numberFormat = 'String';
PowerIndexRouter.numberFormat = 'String';
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
  await router.addLiquidityETH(yfi.address, yfiAmount, ether(1), ether(1), lpTokensTo, deadline, { value: ether(1666)});

  // USDC
  const usdcAmount = mwei(1e6);
  await usdc.approve(router.address, usdcAmount);
  await router.addLiquidityETH(usdc.address, usdcAmount, ether(1), ether(1), lpTokensTo, deadline, { value: ether(1666)});

  return router;
}

describe('YearnRouter Tests', () => {
  let bob, alice, yearnOwner, piOwner, piGov, stub, pvp, pool1, pool2, rewardDistributor;

  before(async function () {
    [, bob, alice, yearnOwner, piOwner, piGov, stub, pvp, pool1, pool2, rewardDistributor] = await web3.eth.getAccounts();
  });

  let yfi, yCrv, usdc, weth, yDeposit, yearnGovernance, poolRestrictions, yfiWrapper, yfiRouter;

  beforeEach(async function () {
    // 0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e
    yfi = await MockERC20.new('yearn.finance', 'YFI', '18', ether('10000000'));
    // 0xdF5e0e81Dff6FAF3A7e52BA697820c5e32D806A8
    yCrv = await MockERC20.new('Curve.fi yDAI/yUSDC/yUSDT/yTUSD ', 'yDAI+yUSDC+yUSDT+yTUSD', '18', ether('10000000'));
    // 0xBa37B002AbaFDd8E89a1995dA52740bbC013D992
    yearnGovernance = await MockYearnGovernance.new();
    usdc = await MockERC20.new('USDC', 'USDC', '6', mwei('10000000'));
    weth = await MockWETH.new();
    yDeposit = await MockYDeposit.new(yCrv.address, usdc.address);

    poolRestrictions = await PoolRestrictions.new();
    yfiWrapper = await WrappedPiErc20.new(yfi.address, stub, 'wrapped.yearn.finance', 'WYFI');
    yfiRouter = await PowerIndexRouter.new(
      yfiWrapper.address,
      poolRestrictions.address,
      yCrv.address,
      usdc.address,
      yfi.address,
      constants.ZERO_ADDRESS,
      yDeposit.address,
      pvp,
      ether('0.15'),
      [pool1, pool2],
      [usdc.address, weth.address, yfi.address]
    );

    await yfiWrapper.changeRouter(yfiRouter.address, { from: stub });

    await yfiRouter.transferOwnership(piOwner);
    await yearnGovernance.transferOwnership(yearnOwner);

    await yearnGovernance.initialize(0, yearnOwner, yfi.address, yCrv.address);
    await yfiRouter.setVotingAndStaking(yearnGovernance.address, yearnGovernance.address, { from: piOwner });
    await yfiRouter.setReserveRatio(ether('0.2'), { from: piOwner });

    assert.equal(await yfiRouter.owner(), piOwner);

    // Hardcoded into the bytecode for the test sake
    assert.equal(await yearnGovernance.period(), 10);
    assert.equal(await yearnGovernance.lock(), 10);
  });

  it('should allow creating a proposal in YearnGovernance', async () => {
    await yfi.transfer(alice, ether('10000'));
    await yfi.approve(yfiWrapper.address, ether('10000'), { from: alice });
    await yfiWrapper.deposit(ether('10000'), { from: alice });

    assert.equal(await yfiWrapper.totalSupply(), ether('10000'));
    assert.equal(await yfiWrapper.balanceOf(alice), ether('10000'));

    // The router has partially staked the deposit with regard to the reserve ration value (20/80)
    assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(2000));
    assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8000));

    // The votes are allocated on the yfiWrapper contract
    assert.equal(await yearnGovernance.balanceOf(yfiWrapper.address), ether(8000));

    const proposalString = 'Lets do it';

    await poolRestrictions.setVotingAllowedForSenders(yearnGovernance.address, [alice], [true]);

    await yfiRouter.callRegister({ from: alice });
    await yfiRouter.callPropose(bob, proposalString, { from: alice });
    await yfiRouter.callVoteFor(0, { from: alice });

    await time.advanceBlockTo((await time.latestBlock()).toNumber() + 10);

    await yearnGovernance.tallyVotes(0);

    const proposal = await yearnGovernance.proposals(0);
    assert.equal(proposal.open, false);
    assert.equal(proposal.totalForVotes, ether(8000));
    assert.equal(proposal.totalAgainstVotes, ether(0));
    assert.equal(proposal.hash, proposalString);
  });

  describe('reserve management', () => {
    beforeEach(async () => {
      await yfi.transfer(alice, ether(100000));
      await yfi.approve(yfiWrapper.address, ether(10000), { from: alice })
      await yfiWrapper.deposit(ether(10000), { from: alice });

      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8000));
      assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(2000));
    })

    it('should increase reserve on deposit', async () => {
      await yfi.approve(yfiWrapper.address, ether(1000), { from: alice })
      await yfiWrapper.deposit(ether(1000), { from: alice });

      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8800));
      assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(2200));
    })

    it('should decrease reserve on withdrawal', async () => {
      await yfiWrapper.approve(yfiWrapper.address, ether(1000), { from: alice })
      await yfiWrapper.withdraw(ether(1000), { from: alice });

      assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(7200));
      assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1800));
    })

    describe('on vote lock', async () => {
      beforeEach(async () => {
        await poolRestrictions.setVotingAllowedForSenders(yearnGovernance.address, [piGov], [true]);

        await yfiRouter.callRegister({ from: piGov });
        await yfiRouter.callPropose(bob, 'buzz', { from: piGov });
        await yfiRouter.callVoteFor(0, { from: piGov });
      });

      it('should not decrease reserve if vote is locked', async () => {
        await yfiWrapper.approve(yfiWrapper.address, ether(1000), { from: alice })
        const res = await yfiWrapper.withdraw(ether(1000), { from: alice });

        await expectEvent.inTransaction(res.tx, yfiRouter, 'IgnoreRedeemDueVoteLock')

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8000));
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1000));
      })

      it('should revert if there is not enough funds in reserve', async () => {
        await yfiWrapper.approve(yfiWrapper.address, ether(3000), { from: alice })
        await expectRevert(
          yfiWrapper.withdraw(ether(3000), { from: alice }),
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('on poke', async () => {
      it('should do nothing when nothing has changed', async () => {
        await yfiWrapper.pokeRouter({ from: bob });

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8000));
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(2000));
      });

      it('should increase reserve if required', async () => {
        await yfi.transfer(yfiWrapper.address, ether(1000), { from: alice });

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8000));
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(3000));

        await yfiWrapper.pokeRouter({ from: bob });

        assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8800));
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(2200));
      })
    });
  });

  describe('reward distribution', async () => {
    let poolA, poolB, poolC, poolD;

    beforeEach(async function() {
      poolA = await MockGulpingBPool.new();
      poolB = await MockGulpingBPool.new();
      poolC = await MockGulpingBPool.new();
      poolD = await MockGulpingBPool.new();
      await yfiRouter.setRewardPools([poolA.address, poolB.address, poolC.address], { from: piOwner });

      await usdc.transfer(yDeposit.address, mwei(10000));
      await yCrv.transfer(yDeposit.address, ether(10000));

      const uniswapRouter = await buildUniswapPair(weth, yfi, usdc, alice);
      await yfiRouter.setUniswapRouter(uniswapRouter.address, { from: piOwner });

      await poolRestrictions.setVotingAllowedForSenders(yearnGovernance.address, [alice], [true]);

      await yCrv.transfer(rewardDistributor, ether('1000000'));
      await yfi.transfer(alice, ether('10000'));
      await yfi.approve(yfiWrapper.address, ether('10000'), { from: alice });
      await yfiWrapper.deposit(ether('10000'), { from: alice });

      assert.equal(await yfiWrapper.totalSupply(), ether('10000'));
      assert.equal(await yfiWrapper.balanceOf(alice), ether('10000'));
      assert.equal(await yearnGovernance.totalSupply(), ether('8000'));

      await yfiWrapper.transfer(poolA.address, 10, { from: alice })
      await yfiWrapper.transfer(poolB.address, 20, { from: alice })

      await yearnGovernance.setRewardDistribution(rewardDistributor, { from: yearnOwner });
      await yearnGovernance.setBreaker(true, { from: yearnOwner });
      await yCrv.approve(yearnGovernance.address, ether(2000), { from: rewardDistributor });
    });

    it('should allow withdrawing rewards from the governance', async () => {
      await yearnGovernance.notifyRewardAmount(ether(2000), { from: rewardDistributor });

      await time.increase(time.duration.days(8))
      const res = await yfiRouter.claimRewards({ from: alice });

      expectEvent(res, 'ClaimRewards', {
        caller: alice,
        yCrvReward: '1999999999999999464000',
        usdcConverted: '1799999999',
        yfiConverted: '1782826875172502033652',
        yfiGain: '1782826875172502033652',
        pvpReward: '267424031275875305047',
        poolRewards: '1515402843896626728605',
        piYfiBalance: '1515402843896626728605',
        uniswapSwapPath: [usdc.address, weth.address, yfi.address],
        pools: [poolA.address, poolB.address, poolC.address],
      })

      await expectEvent.inTransaction(res.tx, poolA, 'Gulp');
      await expectEvent.inTransaction(res.tx, poolB, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolC, 'Gulp');
      await expectEvent.notEmitted.inTransaction(res.tx, poolD, 'Gulp');

      assert.equal(res.logs.length, 4)
      assert.equal(res.logs[1].args.pool, poolA.address);
      assert.equal(res.logs[1].args.amount, '505134281298875576201');
      assert.equal(res.logs[2].args.pool, poolB.address);
      assert.equal(res.logs[2].args.amount, '1010268562597751152403');

      assert.equal(await yfiWrapper.balanceOf(poolA.address), 505134281298875576201 + 10);
      assert.equal(await yfiWrapper.balanceOf(poolB.address), 1010268562597751152403 + 20);
      assert.equal(await yfiWrapper.balanceOf(poolC.address), '0');
      assert.equal(await yfiWrapper.balanceOf(poolD.address), '0');

      assert.equal(await yCrv.balanceOf(yfiRouter.address), '0');
      assert.equal(await usdc.balanceOf(yfiRouter.address), '0');
      assert.equal(await yfi.balanceOf(yfiRouter.address), '0');
    })

    it('should revert if there is no reward available', async () => {
      await expectRevert(yfiRouter.claimRewards({ from: alice }), 'NO_YCRV_REWARD');
    });

    it('should revert when missing reward pools config', async () => {
      const router = await PowerIndexRouter.new(
        yfiWrapper.address,
        poolRestrictions.address,
        yCrv.address,
        usdc.address,
        yfi.address,
        constants.ZERO_ADDRESS,
        yDeposit.address,
        pvp,
        ether('0.15'),
        [],
        [usdc.address, weth.address, yfi.address]
      );
      await expectRevert(router.claimRewards({ from: alice }), 'MISSING_REWARD_POOLS');
    });

    it('should revert when missing reward swap path', async () => {
      const router = await PowerIndexRouter.new(
        yfiWrapper.address,
        poolRestrictions.address,
        yCrv.address,
        usdc.address,
        yfi.address,
        constants.ZERO_ADDRESS,
        yDeposit.address,
        pvp,
        ether('0.15'),
        [pool1, pool2],
        []
      );
      await expectRevert(router.claimRewards({ from: alice }), 'MISSING_REWARD_SWAP_PATH');
    });
  });
});
