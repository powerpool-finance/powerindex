const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { createSnapshot, revertToSnapshot } = require('./helpers/blockchain');
const assert = require('chai').assert;
const CvpToken = artifacts.require('MockCvp');
const LPMining = artifacts.require('LPMining');
const VestedLPMining = artifacts.require('VestedLPMining');
const MockERC20 = artifacts.require('MockERC20');
const Reservoir = artifacts.require('Reservoir');

LPMining.numberFormat = 'String';
MockERC20.numberFormat = 'String';

const { web3 } = Reservoir;
const { toBN } = web3.utils;

function addBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .add(toBN(bn2.toString(10)))
    .toString(10);
}
function mulBN(bn1, bn2) {
  return toBN(bn1.toString(10))
    .mul(toBN(bn2.toString(10)))
    .toString(10);
}

describe('VestedLPMining', () => {
  let alice, bob, carol, minter;
  before(async function () {
    [, alice, bob, carol, minter] = await web3.eth.getAccounts();
  });

  before(async () => {
    this.startBlock = await web3.eth.getBlockNumber();
    this.shiftBlock = blockNum => `${1 * this.startBlock + 1 * blockNum}`;

    this.cvp = await CvpToken.new({ from: minter });
    this.reservoir = await Reservoir.new({ from: minter });

    this.lp = await MockERC20.new('LPToken', 'LP', '10000000000', { from: minter });
    await this.lp.transfer(alice, '1000', { from: minter });
    await this.lp.transfer(bob, '1000', { from: minter });
    await this.lp.transfer(carol, '1000', { from: minter });
    this.lp2 = await MockERC20.new('LPToken2', 'LP2', '10000000000', { from: minter });
    await this.lp2.transfer(alice, '1000', { from: minter });
    await this.lp2.transfer(bob, '1000', { from: minter });
    await this.lp2.transfer(carol, '1000', { from: minter });

    const supply = await this.cvp.totalSupply();
    this.reservoirInitialBalance = toBN(supply).div(toBN('2'));
    await this.cvp.transfer(this.reservoir.address, this.reservoirInitialBalance, { from: minter });

    this.prepareReservoir = async function () {
      await this.reservoir.setApprove(this.cvp.address, this.lpMining.address, supply, { from: minter });
    };
    this.checkCvpSpent = async function (spentValue, pendingValue = '0') {
      const reservoirBalance = await this.cvp.balanceOf(this.reservoir.address);
      const reservoirSpent = toBN(this.reservoirInitialBalance).sub(toBN(reservoirBalance)).toString();
      assert.equal(reservoirSpent, toBN(spentValue).sub(toBN(pendingValue)).toString());
    };
    this.cvpBalanceOf = async user => (await this.cvp.balanceOf(user)).toString();
    this.allCvpOf = async (user, poolId = 0) =>
      (await this.cvp.balanceOf(user)).add(await this.lpMining.pendingCvp(poolId, user)).toString();
  });

  beforeEach(async function () {
    this.snapshot = await createSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(this.snapshot);
  });

  it('should set correct state variables', async () => {
    this.lpMining = await VestedLPMining.new({ from: minter });
    await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '1000', this.shiftBlock('0'), '100', {
      from: minter,
    });
    const cvp = await this.lpMining.cvp();
    assert.equal(cvp.valueOf(), this.cvp.address);
  });

  context('With ERC/LP token added to the field', () => {
    it('should allow emergency withdraw', async () => {
      // 100 per block farming rate starting at block 100 with 1 block vesting period
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(
        this.cvp.address,
        this.reservoir.address,
        '100',
        this.shiftBlock('100'),
        '100000',
        { from: minter },
      );
      await this.prepareReservoir();

      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await this.lpMining.deposit(0, '100', { from: bob });
      assert.equal((await this.lp.balanceOf(bob)).toString(), '900');
      await this.lpMining.emergencyWithdraw(0, { from: bob });
      assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');
    });

    it('should give out CVPs only after farming time', async () => {
      // 100 per block farming rate starting at block 100 with 50 block vesting period
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '100', this.shiftBlock('100'), '50', {
        from: minter,
      });
      await this.prepareReservoir();

      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await this.lpMining.deposit(0, '100', { from: bob });
      await time.advanceBlockTo(this.shiftBlock('89'));
      await this.lpMining.deposit(0, '0', { from: bob }); // block 90
      assert.equal(await this.allCvpOf(bob), '0');
      await time.advanceBlockTo(this.shiftBlock('94'));
      await this.lpMining.deposit(0, '0', { from: bob }); // block 95
      assert.equal(await this.allCvpOf(bob), '0');
      await time.advanceBlockTo(this.shiftBlock('99'));
      await this.lpMining.deposit(0, '0', { from: bob }); // block 100
      assert.equal(await this.allCvpOf(bob), '0');
      await time.advanceBlockTo(this.shiftBlock('100'));
      await this.lpMining.deposit(0, '0', { from: bob }); // block 101
      assert.equal(await this.allCvpOf(bob), '100');
      await time.advanceBlockTo(this.shiftBlock('104'));
      await this.lpMining.deposit(0, '0', { from: bob }); // block 105
      assert.equal(await this.allCvpOf(bob), '500');
    });

    it('should not distribute CVPs if no one deposit', async () => {
      // 100 per block farming rate starting at block 200 with 50 block vesting period
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '100', this.shiftBlock('200'), '50', {
        from: minter,
      });
      await this.prepareReservoir();

      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await time.advanceBlockTo(this.shiftBlock('199'));
      assert.equal(await this.cvpBalanceOf(this.reservoir.address), this.reservoirInitialBalance.toString());
      await time.advanceBlockTo(this.shiftBlock('204'));
      assert.equal(await this.cvpBalanceOf(this.reservoir.address), this.reservoirInitialBalance.toString());
      await time.advanceBlockTo(this.shiftBlock('209'));
      await this.lpMining.deposit(0, '10', { from: bob }); // block 210
      assert.equal(await this.cvpBalanceOf(this.reservoir.address), this.reservoirInitialBalance.toString());
      assert.equal(await this.cvpBalanceOf(bob), '0');
      assert.equal((await this.lp.balanceOf(bob)).toString(), '990');
      await time.advanceBlockTo(this.shiftBlock('219'));
      await this.lpMining.withdraw(0, '10', { from: bob }); // block 220
      assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');
      const pendingCvp = (await this.lpMining.cvpVestingPool()).toString();
      await this.checkCvpSpent('1000', pendingCvp);
      assert.equal(await this.allCvpOf(bob), '1000');
    });

    it('should distribute CVPs properly for each staker', async () => {
      // 100 per block farming rate starting at block 300
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '100', this.shiftBlock('300'), '100', {
        from: minter,
      });
      await this.prepareReservoir();

      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: alice });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await this.lp.approve(this.lpMining.address, '1000', { from: carol });
      // Alice deposits 10 LPs at block 310
      await time.advanceBlockTo(this.shiftBlock('309'));
      await this.lpMining.deposit(0, '10', { from: alice });
      // Bob deposits 20 LPs at block 314
      await time.advanceBlockTo(this.shiftBlock('313'));
      await this.lpMining.deposit(0, '20', { from: bob });
      // Carol deposits 30 LPs at block 318
      await time.advanceBlockTo(this.shiftBlock('317'));
      await this.lpMining.deposit(0, '30', { from: carol });
      // Alice deposits 10 more LPs at block 320. At this point:
      //   Alice should have: 4*100 + 4*1/3*100 + 2*1/6*100 = 566
      //   VestedLPMining should have the remaining: 10000 - 566 = 9434
      await time.advanceBlockTo(this.shiftBlock('319'));
      await this.lpMining.deposit(0, '10', { from: alice });
      const pendingCvp = (await this.lpMining.cvpVestingPool()).toString();
      await this.checkCvpSpent('1000', pendingCvp);
      assert.equal(await this.allCvpOf(alice), '566');
      assert.equal(await this.cvpBalanceOf(bob), '0');
      assert.equal(await this.cvpBalanceOf(carol), '0');
      // Bob withdraws 5 LPs at block 330. At this point:
      //   Bob should have: 4*2/3*100 + 2*2/6*100 + 10*2/7*100 = 619
      await time.advanceBlockTo(this.shiftBlock('329'));
      await this.lpMining.withdraw(0, '5', { from: bob });
      const pendingCvp2 = (await this.lpMining.cvpVestingPool()).toString();
      await this.checkCvpSpent('2000', pendingCvp2);
      assert.equal(await this.allCvpOf(bob), '619');
      assert.equal(await this.cvpBalanceOf(carol), '0');
      // Alice withdraws 20 LPs at block 340.
      // Bob withdraws 15 LPs at block 350.
      // Carol withdraws 30 LPs at block 360.
      await time.advanceBlockTo(this.shiftBlock('339'));
      await this.lpMining.withdraw(0, '20', { from: alice });
      await time.advanceBlockTo(this.shiftBlock('349'));
      await this.lpMining.withdraw(0, '15', { from: bob });
      await time.advanceBlockTo(this.shiftBlock('359'));
      await this.lpMining.withdraw(0, '30', { from: carol });
      const pendingCvp3 = (await this.lpMining.cvpVestingPool()).toString();
      await this.checkCvpSpent('5000', pendingCvp3);
      // Alice should have: 566 + 10*2/7*100 + 10*2/6.5*100 = 1159
      assert.equal(await this.allCvpOf(alice), '1159');
      // Bob should have: 619 + 10*1.5/6.5 * 100 + 10*1.5/4.5*100 = 1183
      assert.equal(await this.allCvpOf(bob), '1183');
      // Carol should have: 2*3/6*100 + 10*3/7*100 + 10*3/6.5*100 + 10*3/4.5*100 + 10*100 = 2657
      assert.equal(await this.allCvpOf(carol), '2657');
      // All of them should have 1000 LPs back.
      assert.equal((await this.lp.balanceOf(alice)).toString(), '1000');
      assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');
      assert.equal((await this.lp.balanceOf(carol)).toString(), '1000');

      //assert.equal((await this.lpMining.cvpVestingPool()).toString(), '815');

      // Out of 1159, Alice should have:
      // 252 vested, 907 pending, of the latest - 201 may be vested at block 360
      assert.equal(`${(await this.cvp.balanceOf.call(alice)).toString()}`, '252');
      assert.equal(`${(await this.lpMining.pendingCvp.call(0, alice)).toString()}`, '907');
      assert.equal(`${(await this.lpMining.vestableCvp.call(0, alice)).toString()}`, '201');
      // Out of 1183, Bob should have:
      // 285 vested, 898 pending, of the latest - 99 may be vested at block 360
      assert.equal(`${(await this.cvp.balanceOf.call(bob)).toString()}`, '285');
      assert.equal(`${(await this.lpMining.pendingCvp.call(0, bob)).toString()}`, '898');
      assert.equal(`${(await this.lpMining.vestableCvp.call(0, bob)).toString()}`, '99');
      // Out of 2657, Carol should have:
      // 785 vested, 1872 pending, of the latest - nothing may be vested at block 360
      assert.equal(`${(await this.cvp.balanceOf.call(carol)).toString()}`, '785');
      assert.equal(`${(await this.lpMining.pendingCvp.call(0, carol)).toString()}`, '1872');
      assert.equal(`${(await this.lpMining.vestableCvp.call(0, carol)).toString()}`, '0');

      // Alice withdraws 214 at block 361 (201 at block 360 + 12 newly released)
      await this.lpMining.withdraw(0, '0', { from: alice }); // block 361
      assert.equal(await this.cvpBalanceOf(alice), '463');

      // In 100 blocks after the withdrawal, the entire amount is vested.
      await time.advanceBlockTo(this.shiftBlock('439'));
      await this.lpMining.withdraw(0, '0', { from: alice });
      assert.equal(await this.cvpBalanceOf(alice), '1370');
      await time.advanceBlockTo(this.shiftBlock('449'));
      await this.lpMining.withdraw(0, '0', { from: bob });
      assert.equal(await this.cvpBalanceOf(bob), '1183');
      await time.advanceBlockTo(this.shiftBlock('459'));
      await this.lpMining.withdraw(0, '0', { from: carol });
      assert.equal(await this.cvpBalanceOf(carol), '2447');
      assert.equal((await this.lpMining.cvpVestingPool()).toString() * 1 <= 1, true);
    });

    it('should give proper CVPs allocation to each pool', async () => {
      // 100 per block farming rate starting at block 400
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '100', this.shiftBlock('400'), '100', {
        from: minter,
      });
      await this.prepareReservoir();

      await this.lp.approve(this.lpMining.address, '1000', { from: alice });
      await this.lp2.approve(this.lpMining.address, '1000', { from: bob });

      assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), false);
      // Add first LP to the pool with allocation 1
      await this.lpMining.add('10', this.lp.address, '1', true, { from: minter });
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');

      // Alice deposits 10 LPs at block 410
      await time.advanceBlockTo(this.shiftBlock('409'));
      await this.lpMining.deposit(0, '10', { from: alice });

      await expectRevert(
        this.lpMining.add('10', this.lp.address, '1', true, { from: minter }),
        'VLPMining: token already added',
      );

      // Add LP2 to the pool with allocation 2 at block 420
      await time.advanceBlockTo(this.shiftBlock('419'));
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), false);
      await this.lpMining.add('20', this.lp2.address, '1', true, { from: minter });
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp2.address), '1');
      // Alice should have 10*1000 pending reward
      assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1000');
      // Bob deposits 10 LP2s at block 425
      await time.advanceBlockTo(this.shiftBlock('424'));
      await this.lpMining.deposit(1, '5', { from: bob });
      // Alice should have 1000 + 5*1/3*1000 = 2666 pending reward
      assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1166');
      await time.advanceBlockTo(this.shiftBlock('430'));
      // At block 430. Bob should get 5*2/3*1000 = 3333. Alice should get ~1666 more.
      assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1333');
      assert.equal((await this.lpMining.pendingCvp(1, bob)).toString(), '333');

      this.lp3 = await MockERC20.new('LPToken3', 'LP3', '10000000000', { from: minter });
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp3.address), false);
      await this.lpMining.add('20', this.lp3.address, '1', true, { from: minter });
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp2.address), '1');
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp3.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp3.address), '2');

      this.lp4 = await MockERC20.new('LPToken4', 'LP4', '10000000000', { from: minter });
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp4.address), false);
      await this.lpMining.add('20', this.lp4.address, '1', true, { from: minter });
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp2.address), '1');
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp3.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp3.address), '2');
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp4.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp4.address), '3');
    });

    it('should stop giving bonus CVPs after the bonus period ends', async () => {
      // 100 per block farming rate starting at block 500
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '100', this.shiftBlock('500'), '100', {
        from: minter,
      });
      await this.prepareReservoir();

      await this.lp.approve(this.lpMining.address, '1000', { from: alice });
      await this.lpMining.add('1', this.lp.address, '1', true, { from: minter });
      // Alice deposits 10 LPs at block 590
      await time.advanceBlockTo(this.shiftBlock('589'));
      await this.lpMining.deposit(0, '10', { from: alice });
      // At block 605, she should have 100*15 = 1500 pending.
      await time.advanceBlockTo(this.shiftBlock('605'));
      assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1500');
      // At block 606, Alice withdraws all pending rewards and should get 1600.
      await this.lpMining.deposit(0, '0', { from: alice });
      // out of 1600, 1380 still pend to be vested and 220 sent to her wallet
      assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1380');
      assert.equal(await this.cvpBalanceOf(alice), '220');
    });

    it('should correctly checkpoint votes', async () => {
      // 100 per block farming rate starting at block 700
      await time.advanceBlockTo(this.shiftBlock('699'));
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '100', this.shiftBlock('700'), '100', {
        from: minter,
      });
      await this.prepareReservoir();

      await this.cvp.transfer(this.lp.address, '5000000000', { from: minter });
      await this.lp.transfer(alice, '1000', { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: alice });

      await this.lpMining.add('1', this.lp.address, '1', true, { from: minter });

      const getUserCurrVotes = async user =>
        (await this.cvp.balanceOf(user)).add(await this.lpMining.getCurrentVotes(user));

      // Alice deposits 10 LPs at block #790
      await time.advanceBlockTo(this.shiftBlock('789'));
      await this.lpMining.deposit(0, '10', { from: alice });
      // console.log('logs', logs.map(e => e.args));
      const firstBlockNumber = await web3.eth.getBlockNumber(); // block #790
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
      await time.advanceBlockTo(this.shiftBlock('805'));
      // At block #805, she should have 100*15 = 1500 CVP (as the reward) pending.
      assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1500');

      await this.lpMining.deposit(0, '10', { from: alice });
      const secondBlockNumber = await web3.eth.getBlockNumber(); // block #806
      await time.advanceBlock();

      // At block #807 (since `deposit` on #806), she has 100*16 "reward" CVP and 10 CVP as the share in LP pools
      assert.equal((await getUserCurrVotes(alice)).toString(), '1610');
      // 220 from the CVP award has been vested ...
      assert.equal((await this.cvp.balanceOf(alice)).toString(), '220');
      // ... 1380 remains pending, plus 10 as the share in LP pool(s) CVP
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '1390');

      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');

      await this.lpMining.deposit(0, '40', { from: alice });
      const thirdBlockNumber = await web3.eth.getBlockNumber(); // block 808
      await time.advanceBlock();

      // At block #809 (since `deposit` on #808), she should have 100*18 "reward" CVP and 30 "LP share" CVP
      assert.equal((await getUserCurrVotes(alice)).toString(), '1830');
      assert.equal((await this.cvp.balanceOf(alice)).toString(), '250');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '1580');
      // Previously registered values shall remain unchanged
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '1390');

      await this.lpMining.withdraw(0, '10', { from: alice });
      const fourthBlockNumber = await web3.eth.getBlockNumber(); // block #810
      await time.advanceBlock();

      // At block #811 (since `withdraw` on #810), she has 100*20 "reward" CVP and 25 "share" CVP
      assert.equal((await getUserCurrVotes(alice)).toString(), '2024'); // +1 - rounding error
      assert.equal((await this.cvp.balanceOf(alice)).toString(), '284'); // +1
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '1740');
      // Previously registered values shall remain unchanged
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '1390');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '1580');

      await this.cvp.transfer(this.lp.address, '5000000000', { from: minter });
      await this.lpMining.checkpointVotes(alice);
      const fifthBlockNumber = await web3.eth.getBlockNumber(); // block #813
      await time.advanceBlock();

      // At block #814 (since `withdraw` on #810), same 2000 "award" CVP,
      // but the "share" CVP amount is 50 (as the LP poll increased on block #819)
      assert.equal((await getUserCurrVotes(alice)).toString(), '2049'); // +1 - rounding error
      assert.equal((await this.cvp.balanceOf(alice)).toString(), '284'); // +1
      assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).toString(), '1765');
      // Previously registered values shall remain unchanged
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '1390');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '1580');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '1740');

      await this.cvp.transfer(this.lp2.address, '5000000000', { from: minter });
      await this.lp2.transfer(alice, '1000', { from: minter });
      await this.lp2.approve(this.lpMining.address, '1000', { from: alice });
      await this.lpMining.add('1', this.lp2.address, '1', true, { from: minter }); // block #818
      await this.lpMining.deposit('1', '10', { from: alice }); // block #819
      const sixthBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock(); // block #820

      // At block #820 she has:
      // - same 2000 "award" CVP for the 1st poll - same since `withdraw` on #810
      // - yet zero CVP "award" for the 2nd pool - since `deposit` on #816
      // - 55 "share" CVP after `deposit` on #819
      assert.equal((await getUserCurrVotes(alice)).toString(), '2053'); // +2 - rounding error
      assert.equal((await this.cvp.balanceOf(alice)).toString(), '284'); // +1
      assert.equal((await this.lpMining.getPriorVotes(alice, sixthBlockNumber)).toString(), '1769');
      // Previously registered values shall remain unchanged
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '1390');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '1580');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '1740');
      assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).toString(), '1765');

      await this.lpMining.withdraw(0, 0, { from: alice }); // block #821
      await this.lpMining.withdraw(1, 0, { from: alice }); // block #822
      const seventhBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();

      // At block #823, she has:
      // - since `withdraw` on #821, 3100 of "reward" CVP, 50 as a share in the 1st pool, and 5 in the 2nd
      assert.equal((await getUserCurrVotes(alice)).toString(), '3153'); // +2 - rounding error
      assert.equal((await this.cvp.balanceOf(alice)).toString(), '578');
      assert.equal((await this.lpMining.getPriorVotes(alice, seventhBlockNumber)).toString(), '2575');
      // Previously registered values shall remain unchanged
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '1390');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '1580');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '1740');
      assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).toString(), '1765');
      assert.equal((await this.lpMining.getPriorVotes(alice, sixthBlockNumber)).toString(), '1769');

      await this.lpMining.emergencyWithdraw(0, { from: alice }); // block #823

      await this.lpMining.checkpointVotes(alice);
      await time.advanceBlock();
      // assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '4'); // +1 - rounding error

      await this.lpMining.set(1, '1', '1', false, { from: minter });
      await this.lpMining.checkpointVotes(alice);
      const eighthBlockNumber = await web3.eth.getBlockNumber(); // block #828
      await time.advanceBlock();

      // `emergencyWithdraw` on #832: less 2375 "award" CVP and 50 "share" CVP - both for the 1st pool
      assert.equal((await getUserCurrVotes(alice)).toString(), '724'); // +1 - rounding error
      assert.equal((await this.cvp.balanceOf(alice)).toString(), '578');
      assert.equal((await this.lpMining.getPriorVotes(alice, eighthBlockNumber)).toString(), '146');
      // Previously registered values shall remain unchanged
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '1390');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '1580');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '1740');
      assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).toString(), '1765');
      assert.equal((await this.lpMining.getPriorVotes(alice, sixthBlockNumber)).toString(), '1769');
      assert.equal((await this.lpMining.getPriorVotes(alice, seventhBlockNumber)).toString(), '2575');
    });

    it('cvpPerBlock can be changed by owner', async () => {
      await time.advanceBlockTo(this.shiftBlock('899'));
      // 100 per block farming rate starting at block 900
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '100', this.shiftBlock('900'), '100', {
        from: minter,
      });
      await this.prepareReservoir();

      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await time.advanceBlockTo(this.shiftBlock('909'));
      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lpMining.deposit(0, '100', { from: bob });
      await time.advanceBlockTo(this.shiftBlock('919'));
      await this.lpMining.deposit(0, '0', { from: bob }); // block 920
      assert.equal(await this.allCvpOf(bob), '900');

      await expectRevert(this.lpMining.setCvpPerBlock('200', { from: alice }), 'Ownable: caller is not the owner');
      await this.lpMining.setCvpPerBlock('200', { from: minter });

      await time.advanceBlockTo(this.shiftBlock('929'));
      await this.lpMining.deposit(0, '0', { from: bob }); // block 930
      assert.equal(await this.allCvpOf(bob), '2900');
    });

    it('cvpVestingPeriodInBlocks can be changed by owner', async () => {
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(this.cvp.address, this.reservoir.address, '100', this.shiftBlock('900'), '100', {
        from: minter,
      });

      await expectRevert(
        this.lpMining.setCvpVestingPeriodInBlocks('200', { from: alice }),
        'Ownable: caller is not the owner',
      );
      await this.lpMining.setCvpVestingPeriodInBlocks('200', { from: minter });
      assert.equal(await this.lpMining.cvpVestingPeriodInBlocks(), '200');
    });
  });

  describe('Migration from LPMining to VestedLPMining', () => {
    it('should allow set cvpPerBlock 0 and migrate to new LPMining', async () => {
      const startBlock = await web3.eth.getBlockNumber();
      const cvpPerBlock = '100';

      this.oldLpMining = await LPMining.new(this.cvp.address, this.reservoir.address, cvpPerBlock, '0', {
        from: minter,
      });
      await this.reservoir.setApprove(this.cvp.address, this.oldLpMining.address, this.reservoirInitialBalance, {
        from: minter,
      });

      await this.oldLpMining.add('100', this.lp.address, '1', true, { from: minter });

      await this.lp.approve(this.oldLpMining.address, '1000', { from: bob });
      await this.oldLpMining.deposit('0', '100', { from: bob });

      await time.advanceBlockTo(startBlock + 100);

      let pendingCvp = await this.oldLpMining.pendingCvp('0', bob);
      let res = await this.oldLpMining.deposit('0', '0', { from: bob });
      const { args: firstCvpReward } = CvpToken.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'Transfer')[0];

      const stage1Balance = (await this.cvp.balanceOf(bob)).toString();
      assert.equal(addBN(pendingCvp, cvpPerBlock), firstCvpReward.value.toString());
      assert.equal(stage1Balance.toString(), firstCvpReward.value.toString());

      await time.advanceBlockTo(startBlock + 200);

      const pendingCvpBeforeDisable = mulBN(cvpPerBlock, '100');

      // End of old LpMining, start migrating...
      const poolUserBeforeDisabling = await this.oldLpMining.userInfo('0', bob);

      assert.equal((await this.cvp.balanceOf(this.oldLpMining.address)).toString(), '0');
      const poolBeforePreparingPool = await this.oldLpMining.poolInfo('0');
      await this.oldLpMining.updatePool('0');
      assert.equal((await this.cvp.balanceOf(this.oldLpMining.address)).toString(), pendingCvpBeforeDisable);

      const pendingCvpBeforeDisablePool = await this.oldLpMining.pendingCvp('0', bob);

      const poolBeforeDisabling = await this.oldLpMining.poolInfo('0');
      assert.equal((await this.cvp.balanceOf(this.oldLpMining.address)).toString(), pendingCvpBeforeDisable);
      await this.oldLpMining.setCvpPerBlock('0', { from: minter });

      assert.equal((await this.cvp.balanceOf(this.oldLpMining.address)).toString(), pendingCvpBeforeDisable);
      await this.oldLpMining.updatePool('0');
      assert.equal((await this.cvp.balanceOf(this.oldLpMining.address)).toString(), pendingCvpBeforeDisable);

      const poolAfterDisabling = await this.oldLpMining.poolInfo('0');
      assert.notEqual(poolBeforePreparingPool.accCvpPerShare, poolBeforeDisabling.accCvpPerShare);
      assert.equal(poolAfterDisabling.accCvpPerShare, poolBeforeDisabling.accCvpPerShare);

      await time.advanceBlockTo(startBlock + 300);

      const pendingCvpAfterDisablePool = await this.oldLpMining.pendingCvp('0', bob);

      assert.equal(pendingCvpBeforeDisablePool.toString(), pendingCvpAfterDisablePool.toString());

      await time.advanceBlockTo(startBlock + 400);

      const pendingCvpAfterDisablePoolAndSpentSomeBlocks = await this.oldLpMining.pendingCvp('0', bob);

      assert.equal(pendingCvpBeforeDisable, pendingCvpAfterDisablePoolAndSpentSomeBlocks);

      const poolUserBeforeClaiming = await this.oldLpMining.userInfo('0', bob);
      assert.equal(poolUserBeforeClaiming.rewardDebt, poolUserBeforeDisabling.rewardDebt);

      assert.equal((await this.cvp.balanceOf(bob)).toString(), stage1Balance);
      await this.oldLpMining.deposit('0', '0', { from: bob });

      assert.equal((await this.cvp.balanceOf(bob)).toString(), addBN(stage1Balance, pendingCvpBeforeDisable));

      await time.advanceBlockTo(startBlock + 500);

      pendingCvp = await this.oldLpMining.pendingCvp('0', bob);
      assert.equal(pendingCvp.toString(10), '0');

      await this.oldLpMining.updatePool('0');
      assert.equal((await this.cvp.balanceOf(this.oldLpMining.address)).toString(), '0');
      await time.advanceBlockTo(startBlock + 600);
      const lpBalanceBeforeWithdraw = await this.lp.balanceOf(bob);
      await this.oldLpMining.withdraw('0', '100', { from: bob });
      assert.equal((await this.cvp.balanceOf(this.oldLpMining.address)).toString(), '0');
      assert.equal(await this.lp.balanceOf(bob), addBN(lpBalanceBeforeWithdraw, '100'));

      // 100 per block farming rate starting at block 100 with 1 block vesting period
      this.lpMining = await VestedLPMining.new({ from: minter });
      await this.lpMining.initialize(
        this.cvp.address,
        this.reservoir.address,
        '100',
        this.shiftBlock('100'),
        '100000',
        { from: minter },
      );
      await this.prepareReservoir();

      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await this.lpMining.deposit(0, '100', { from: bob });
      assert.equal((await this.lp.balanceOf(bob)).toString(), '900');
    });
  });
});
