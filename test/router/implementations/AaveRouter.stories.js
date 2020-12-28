const { constants, time, expectEvent } = require('@openzeppelin/test-helpers');
const { artifactFromBytecode, ether } = require('../../helpers');
const { buildBasicRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const AavePowerIndexRouter = artifacts.require('AavePowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const { web3 } = MockERC20;

const StakedAave = artifactFromBytecode('aave/StakedAaveV2');

MockERC20.numberFormat = 'String';
AavePowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const COOLDOWN_STATUS = {
  NONE: 0,
  COOLDOWN: 1,
  UNSTAKE_WINDOW: 2,
};

describe('AaveRouter Tests', () => {
  let minter, bob, alice, rewardsVault, emissionManager, stub;
  let aave, stakedAave, aaveWrapper, aaveRouter, poolRestrictions;

  before(async function () {
    [
      minter,
      bob,
      alice,
      rewardsVault,
      emissionManager,
      stub,
    ] = await web3.eth.getAccounts();
  });

  beforeEach(async function () {
    // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
    aave = await MockERC20.new('Aave Token', 'AAVE', '18', ether('100000000000'));

    // Setting up Aave Governance and Staking
    // 0x4da27a545c0c5B758a6BA100e3a049001de870f5
    stakedAave = await StakedAave.new(
      // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
      aave.address,
      // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
      aave.address,
      864000,
      172800,
      rewardsVault,
      emissionManager,
      12960000,
      'Staked Aave',
      'stkAAVE',
      18,
      // governance
      constants.ZERO_ADDRESS
    );
    poolRestrictions = await PoolRestrictions.new();
    aaveWrapper = await WrappedPiErc20.new(aave.address, stub, 'wrapped.aave', 'WAAVE');
    aaveRouter = await AavePowerIndexRouter.new(aaveWrapper.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        stub,
        stakedAave.address,
        ether('0.2'),
        '0'
      ),
    );

    // Setting up...
    await aaveWrapper.changeRouter(aaveRouter.address, { from: stub });

    // Checks...
    assert.equal(await aaveRouter.owner(), minter);
  });

  describe('staking', async () => {
    it('story #1', async () => {
      await aave.transfer(alice, ether('10000'));
      await aave.transfer(bob, ether('10000'));

      ///////////////////////
      // Step #1. Deposit 10K
      await aave.approve(aaveWrapper.address, ether(10000), { from: alice });
      let res = await aaveWrapper.deposit(ether('10000'), { from: alice });

      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'Redeem');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'TriggerCooldown');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'IgnoreRedeemDueCoolDown');
      await expectEvent.inTransaction(res.tx, AavePowerIndexRouter, 'Stake', {
        amount: ether(8000),
      });

      assert.equal(await aaveWrapper.totalSupply(), ether(10000));
      assert.equal(await aaveWrapper.balanceOf(alice), ether(10000));

      // The router has partially staked the deposit with regard to the reserve ration value (20/80)
      assert.equal(await aave.balanceOf(aaveWrapper.address), ether(2000));
      assert.equal(await aave.balanceOf(stakedAave.address), ether(8000));

      // The stakeAave are allocated on the aaveWrapper contract
      assert.equal(await stakedAave.balanceOf(aaveWrapper.address), ether(8000));

      res = await aaveRouter.getCoolDownStatus();
      assert.equal(res.status, COOLDOWN_STATUS.NONE);

      //////////////////////////
      // Step #2. Withdraw 0.5K
      await aaveWrapper.approve(aaveWrapper.address, ether(500), { from: alice });
      res = await aaveWrapper.withdraw(ether(500), { from: alice });

      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'Stake');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'Redeem');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'IgnoreRedeemDueCoolDown');
      await expectEvent.inTransaction(res.tx, AavePowerIndexRouter, 'TriggerCooldown', {});
      await expectEvent.inTransaction(res.tx, StakedAave, 'Cooldown', {
        user: aaveWrapper.address,
      });

      assert.equal(await aave.balanceOf(aaveWrapper.address), ether(1500));
      assert.equal(await aave.balanceOf(stakedAave.address), ether(8000));

      res = await aaveRouter.getCoolDownStatus();
      assert.equal(res.status, COOLDOWN_STATUS.COOLDOWN);

      ///////////////////////////////////////////////////////
      // Step #3. Withdraw 0.5K - waiting for a COOLDOWN ends
      await aaveWrapper.approve(aaveWrapper.address, ether(500), { from: alice });
      res = await aaveWrapper.withdraw(ether(500), { from: alice });

      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'Stake');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'Redeem');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'TriggerCooldown');
      await expectEvent.notEmitted.inTransaction(res.tx, StakedAave, 'Cooldown');
      await expectEvent.inTransaction(res.tx, AavePowerIndexRouter, 'IgnoreRedeemDueCoolDown', {});

      assert.equal(await aave.balanceOf(aaveWrapper.address), ether(1000));
      assert.equal(await aave.balanceOf(stakedAave.address), ether(8000));

      // Jump to the end of the already triggered COOLDOWN period
      await time.increase(time.duration.days(10));

      res = await aaveRouter.getCoolDownStatus();
      assert.equal(res.status, COOLDOWN_STATUS.UNSTAKE_WINDOW);

      //////////////////////////////////////////////////////////
      // Step #4. Withdraw 0.5K - while within an UNSTAKE_WINDOW
      await aaveWrapper.approve(aaveWrapper.address, ether(500), { from: alice });
      res = await aaveWrapper.withdraw(ether(500), { from: alice });

      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'Stake');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'TriggerCooldown');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'IgnoreRedeemDueCoolDown');
      await expectEvent.inTransaction(res.tx, AavePowerIndexRouter, 'Redeem', {
        amount: ether(1200),
      });

      assert.equal(await aave.balanceOf(aaveWrapper.address), ether(1700));
      assert.equal(await aave.balanceOf(stakedAave.address), ether(6800));

      //////////////////////////////////////////////////////////
      // Step #5. Withdraw 0.5K - while within an UNSTAKE_WINDOW
      await aaveWrapper.approve(aaveWrapper.address, ether(500), { from: alice });
      res = await aaveWrapper.withdraw(ether(500), { from: alice });

      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'Stake');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'TriggerCooldown');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'IgnoreRedeemDueCoolDown');
      await expectEvent.inTransaction(res.tx, AavePowerIndexRouter, 'Redeem', {
        amount: ether(400),
      });

      assert.equal(await aave.balanceOf(aaveWrapper.address), ether(1600));
      assert.equal(await aave.balanceOf(stakedAave.address), ether(6400));

      ///////////////////////////////////////////////////////
      // Step #6. Deposit 3K - while within an UNSTAKE_WINDOW
      await aave.approve(aaveWrapper.address, ether(3000), { from: bob });
      res = await aaveWrapper.deposit(ether(3000), { from: bob });

      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'Redeem');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'TriggerCooldown');
      await expectEvent.notEmitted.inTransaction(res.tx, AavePowerIndexRouter, 'IgnoreRedeemDueCoolDown');
      await expectEvent.inTransaction(res.tx, AavePowerIndexRouter, 'Stake', {
        amount: ether(2400),
      });

      assert.equal(await aaveWrapper.totalSupply(), ether(11000));
      assert.equal(await aave.balanceOf(aaveWrapper.address), ether(2200));
      assert.equal(await aave.balanceOf(stakedAave.address), ether(8800));
    });
  });
});
