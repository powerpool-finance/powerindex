const { expectRevert, time } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const CvpToken = artifacts.require('MockCvp');
const LPMining = artifacts.require('LPMining');
const MockERC20 = artifacts.require('MockERC20');
const Reservoir = artifacts.require('Reservoir');

const { web3 } = Reservoir;
const { toBN } = web3.utils;

describe('LPMining', () => {
  let alice, bob, carol, minter;
  before(async function () {
    [alice, bob, carol, minter] = await web3.eth.getAccounts();
  });
  let supply;
  let reservoirInitialBalance;
  beforeEach(async () => {
    this.cvp = await CvpToken.new({ from: minter });
    this.reservoir = await Reservoir.new({ from: minter });

    this.prepareReservoir = async function () {
      supply = await this.cvp.totalSupply();
      reservoirInitialBalance = toBN(supply).div(toBN('2'));
      await this.cvp.transfer(this.reservoir.address, reservoirInitialBalance, { from: minter });
      await this.reservoir.setApprove(this.cvp.address, this.lpMining.address, supply, { from: minter });
    };

    this.checkCvpSpent = async function (spentValue) {
      const reservoirBalance = await this.cvp.balanceOf(this.reservoir.address);
      assert.equal(
        toBN(reservoirInitialBalance).sub(toBN(reservoirBalance)).toString(10),
        toBN(spentValue).toString(10),
      );
    };
  });

  it('should set correct state variables', async () => {
    this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '1000', '0', { from: minter });
    await this.prepareReservoir();
    const cvp = await this.lpMining.cvp();
    assert.equal(cvp.valueOf(), this.cvp.address);
  });

  context('With ERC/LP token added to the field', () => {
    beforeEach(async () => {
      this.lp = await MockERC20.new('LPToken', 'LP', '10000000000', { from: minter });
      await this.lp.transfer(alice, '1000', { from: minter });
      await this.lp.transfer(bob, '1000', { from: minter });
      await this.lp.transfer(carol, '1000', { from: minter });
      this.lp2 = await MockERC20.new('LPToken2', 'LP2', '10000000000', { from: minter });
      await this.lp2.transfer(alice, '1000', { from: minter });
      await this.lp2.transfer(bob, '1000', { from: minter });
      await this.lp2.transfer(carol, '1000', { from: minter });
    });

    it('should allow emergency withdraw', async () => {
      // 100 per block farming rate starting at block 100
      this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '100', '1100', { from: minter });
      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await this.lpMining.deposit(0, '100', { from: bob });
      assert.equal((await this.lp.balanceOf(bob)).valueOf(), '900');
      await this.lpMining.emergencyWithdraw(0, { from: bob });
      assert.equal((await this.lp.balanceOf(bob)).valueOf(), '1000');
    });

    it('should give out CVPs only after farming time', async () => {
      // 100 per block farming rate starting at block 100
      this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '100', '1100', { from: minter });
      await this.prepareReservoir();
      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await this.lpMining.deposit(0, '100', { from: bob });
      await time.advanceBlockTo('1089');
      await this.lpMining.deposit(0, '0', { from: bob }); // block 1090
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
      await time.advanceBlockTo('1094');
      await this.lpMining.deposit(0, '0', { from: bob }); // block 1095
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
      await time.advanceBlockTo('1099');
      await this.lpMining.deposit(0, '0', { from: bob }); // block 1100
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
      await time.advanceBlockTo('1100');
      await this.lpMining.deposit(0, '0', { from: bob }); // block 1101
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '100');
      await time.advanceBlockTo('1104');
      await this.lpMining.deposit(0, '0', { from: bob }); // block 1105
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '500');
    });

    it('should not distribute CVPs if no one deposit', async () => {
      // 100 per block farming rate starting at block 200
      this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '100', '1200', { from: minter });
      await this.prepareReservoir();
      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await time.advanceBlockTo('1199');
      assert.equal(
        (await this.cvp.balanceOf(this.reservoir.address)).toString(10),
        reservoirInitialBalance.toString(10),
      );
      await time.advanceBlockTo('1204');
      assert.equal(
        (await this.cvp.balanceOf(this.reservoir.address)).toString(10),
        reservoirInitialBalance.toString(10),
      );
      await time.advanceBlockTo('1209');
      await this.lpMining.deposit(0, '10', { from: bob }); // block 1210
      assert.equal(
        (await this.cvp.balanceOf(this.reservoir.address)).toString(10),
        reservoirInitialBalance.toString(10),
      );
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
      assert.equal((await this.lp.balanceOf(bob)).valueOf(), '990');
      await time.advanceBlockTo('1219');
      await this.lpMining.withdraw(0, '10', { from: bob }); // block 1220
      await this.checkCvpSpent('1000');
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '1000');
      assert.equal((await this.lp.balanceOf(bob)).valueOf().toString(10), '1000');
    });

    it('should distribute CVPs properly for each staker', async () => {
      // 100 per block farming rate starting at block 300
      this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '100', '1300', { from: minter });
      await this.prepareReservoir();
      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: alice });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await this.lp.approve(this.lpMining.address, '1000', { from: carol });
      // Alice deposits 10 LPs at block 1310
      await time.advanceBlockTo('1309');
      await this.lpMining.deposit(0, '10', { from: alice });
      // Bob deposits 20 LPs at block 314
      await time.advanceBlockTo('1313');
      await this.lpMining.deposit(0, '20', { from: bob });
      // Carol deposits 30 LPs at block 1318
      await time.advanceBlockTo('1317');
      await this.lpMining.deposit(0, '30', { from: carol });
      // Alice deposits 10 more LPs at block 1320. At this point:
      //   Alice should have: 4*100 + 4*1/3*100 + 2*1/6*100 = 566
      //   LPMining should have the remaining: 10000 - 566 = 9434
      await time.advanceBlockTo('1319');
      await this.lpMining.deposit(0, '10', { from: alice });
      await this.checkCvpSpent('1000');
      assert.equal((await this.cvp.balanceOf(alice)).valueOf(), '566');
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
      assert.equal((await this.cvp.balanceOf(carol)).valueOf(), '0');
      assert.equal((await this.cvp.balanceOf(this.lpMining.address)).valueOf().toString(10), '434');
      // Bob withdraws 5 LPs at block 330. At this point:
      //   Bob should have: 4*2/3*100 + 2*2/6*100 + 10*2/7*100 = 619
      await time.advanceBlockTo('1329');
      await this.lpMining.withdraw(0, '5', { from: bob });
      await this.checkCvpSpent('2000');
      assert.equal((await this.cvp.balanceOf(alice)).valueOf(), '566');
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '619');
      assert.equal((await this.cvp.balanceOf(carol)).valueOf(), '0');
      assert.equal((await this.cvp.balanceOf(this.lpMining.address)).valueOf().toString(10), '815');
      // Alice withdraws 20 LPs at block 1340.
      // Bob withdraws 15 LPs at block 1350.
      // Carol withdraws 30 LPs at block 1360.
      await time.advanceBlockTo('1339');
      await this.lpMining.withdraw(0, '20', { from: alice });
      await time.advanceBlockTo('1349');
      await this.lpMining.withdraw(0, '15', { from: bob });
      await time.advanceBlockTo('1359');
      await this.lpMining.withdraw(0, '30', { from: carol });
      await this.checkCvpSpent('5000');
      // Alice should have: 566 + 10*2/7*100 + 10*2/6.5*100 = 1159
      assert.equal((await this.cvp.balanceOf(alice)).valueOf().toString(10), '1159');
      // Bob should have: 619 + 10*1.5/6.5 * 100 + 10*1.5/4.5*100 = 1183
      assert.equal((await this.cvp.balanceOf(bob)).valueOf().toString(10), '1183');
      // Carol should have: 2*3/6*100 + 10*3/7*100 + 10*3/6.5*100 + 10*3/4.5*100 + 10*100 = 2657
      assert.equal((await this.cvp.balanceOf(carol)).valueOf().toString(10), '2657');
      // All of them should have 1000 LPs back.
      assert.equal((await this.lp.balanceOf(alice)).valueOf().toString(10), '1000');
      assert.equal((await this.lp.balanceOf(bob)).valueOf().toString(10), '1000');
      assert.equal((await this.lp.balanceOf(carol)).valueOf().toString(10), '1000');
    });

    it('should give proper CVPs allocation to each pool', async () => {
      // 100 per block farming rate starting at block 1400
      this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '100', '1400', { from: minter });
      await this.prepareReservoir();
      await this.lp.approve(this.lpMining.address, '1000', { from: alice });
      await this.lp2.approve(this.lpMining.address, '1000', { from: bob });

      assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), false);
      // Add first LP to the pool with allocation 1
      await this.lpMining.add('10', this.lp.address, '1', true, { from: minter });
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');

      // Alice deposits 10 LPs at block 1410
      await time.advanceBlockTo('1409');
      await this.lpMining.deposit(0, '10', { from: alice });

      await expectRevert(
        this.lpMining.add('10', this.lp.address, '1', true, { from: minter }),
        'add: Lp token already added',
      );

      // Add LP2 to the pool with allocation 2 at block 1420
      await time.advanceBlockTo('1419');
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), false);
      await this.lpMining.add('20', this.lp2.address, '1', true, { from: minter });
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');
      assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), true);
      assert.equal(await this.lpMining.poolPidByAddress(this.lp2.address), '1');
      // Alice should have 10*1000 pending reward
      assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf(), '1000');
      // Bob deposits 10 LP2s at block 425
      await time.advanceBlockTo('1424');
      await this.lpMining.deposit(1, '5', { from: bob });
      // Alice should have 1000 + 5*1/3*1000 = 2666 pending reward
      assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf().toString(10), '1166');
      await time.advanceBlockTo('1430');
      // At block 430. Bob should get 5*2/3*1000 = 3333. Alice should get ~1666 more.
      assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf().toString(10), '1333');
      assert.equal((await this.lpMining.pendingCvp(1, bob)).valueOf().toString(10), '333');

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
      // 100 per block farming rate starting at block 1500
      this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '100', '1500', { from: minter });
      await this.prepareReservoir();
      await this.lp.approve(this.lpMining.address, '1000', { from: alice });
      await this.lpMining.add('1', this.lp.address, '1', true, { from: minter });
      // Alice deposits 10 LPs at block 1590
      await time.advanceBlockTo('1589');
      await this.lpMining.deposit(0, '10', { from: alice });
      // At block 605, she should have 100*15 = 1500 pending.
      await time.advanceBlockTo('1605');
      assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf(), '1500');
      // At block 606, Alice withdraws all pending rewards and should get 10600.
      await this.lpMining.deposit(0, '0', { from: alice });
      assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf(), '0');
      assert.equal((await this.cvp.balanceOf(alice)).valueOf(), '1600');
    });

    it('should correctly checkpoint votes', async () => {
      // 100 per block farming rate starting at block 1700
      await time.advanceBlockTo('1699');
      this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '100', '1700', { from: minter });
      await this.prepareReservoir();

      await this.cvp.transfer(this.lp.address, '5000000000', { from: minter });
      await this.lp.transfer(alice, '1000', { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: alice });

      await this.lpMining.add('1', this.lp.address, '1', true, { from: minter });

      // Alice deposits 10 LPs at block 1790
      await time.advanceBlockTo('1789');
      await this.lpMining.deposit(0, '10', { from: alice });
      // console.log('logs', logs.map(e => e.args));
      const firstBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
      // At block 805, she should have 100*15 = 1500 pending.
      await time.advanceBlockTo('1805');
      assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf().toString(10), '1500');

      await this.lpMining.deposit(0, '10', { from: alice });
      const secondBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '10');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');

      await this.lpMining.deposit(0, '40', { from: alice });
      const thirdBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '30');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).valueOf(), '30');

      await this.lpMining.withdraw(0, '10', { from: alice });
      const fourthBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '25');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).valueOf(), '30');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).valueOf(), '25');

      await this.cvp.transfer(this.lp.address, '5000000000', { from: minter });
      await this.lpMining.checkpointVotes(alice);
      const fifthBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '50');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).valueOf(), '30');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).valueOf(), '25');
      assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).valueOf(), '50');

      await this.cvp.transfer(this.lp2.address, '5000000000', { from: minter });
      await this.lp2.transfer(alice, '1000', { from: minter });
      await this.lp2.approve(this.lpMining.address, '1000', { from: alice });

      await this.lpMining.add('1', this.lp2.address, '1', true, { from: minter });
      await this.lpMining.deposit('1', '10', { from: alice });
      const sixthBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '55');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).valueOf(), '30');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).valueOf(), '25');
      assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).valueOf(), '50');
      assert.equal((await this.lpMining.getPriorVotes(alice, sixthBlockNumber)).valueOf(), '55');

      await this.lpMining.checkpointVotes(alice);
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '55');

      await this.lpMining.emergencyWithdraw(0, { from: alice });
      const seventhBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).valueOf(), '30');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).valueOf(), '25');
      assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).valueOf(), '50');
      assert.equal((await this.lpMining.getPriorVotes(alice, seventhBlockNumber)).valueOf(), '5');

      await this.lpMining.checkpointVotes(alice);
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '5');

      await this.lpMining.set(1, '1', '1', false, { from: minter });
      await this.lpMining.checkpointVotes(alice);
      const eighthBlockNumber = await web3.eth.getBlockNumber();
      await time.advanceBlock();
      assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '0');
      assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');
      assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).valueOf(), '30');
      assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).valueOf(), '25');
      assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).valueOf(), '50');
      assert.equal((await this.lpMining.getPriorVotes(alice, seventhBlockNumber)).valueOf(), '5');
      assert.equal((await this.lpMining.getPriorVotes(alice, eighthBlockNumber)).valueOf(), '0');
    });

    it('cvpPerBlock can be changed by owner', async () => {
      await time.advanceBlockTo('1899');
      // 100 per block farming rate starting at block 1900
      this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '100', '1900', { from: minter });
      await this.prepareReservoir();
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await time.advanceBlockTo('1909');
      await this.lpMining.add('100', this.lp.address, '1', true, { from: minter });
      await this.lpMining.deposit(0, '100', { from: bob });
      await time.advanceBlockTo('1919');
      await this.lpMining.deposit(0, '0', { from: bob }); // block 920
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '900');

      await expectRevert(this.lpMining.setCvpPerBlock('200', { from: alice }), 'Ownable: caller is not the owner');
      await this.lpMining.setCvpPerBlock('200', { from: minter });

      await time.advanceBlockTo('1929');
      await this.lpMining.deposit(0, '0', { from: bob }); // block 1930
      assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '2900');
    });
  });
});
