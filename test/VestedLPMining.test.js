/* global after, afterEach, artifacts, before, beforeEach, contract, describe, it, web3 */
const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { createSnapshot, revertToSnapshot } = require('./helpers/blockchain');
const CvpToken = artifacts.require('MockCvp');
const VestedLPMining = artifacts.require('VestedLPMining');
const MockERC20 = artifacts.require('MockERC20');
const Reservoir = artifacts.require('Reservoir');

const {web3} = Reservoir;
const {toBN} = web3.utils;

contract('VestedLPMining', ([ , alice, bob, carol, minter ]) => {

    before(async () => {
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

        this.prepareReservoir = async function() {
            await this.reservoir.setApprove(this.cvp.address, this.lpMining.address, supply, {from: minter});
        }
        this.checkCvpSpent = async function(spentValue, pendingValue = '0') {
            const reservoirBalance = await this.cvp.balanceOf(this.reservoir.address);
            const reservoirSpent = toBN(this.reservoirInitialBalance).sub(toBN(reservoirBalance)).toString();
            assert.equal(reservoirSpent, toBN(spentValue).sub(toBN(pendingValue)).toString());
        };
        this.cvpBalanceOf = async (user) => (await this.cvp.balanceOf(user)).toString();
        this.allCvpOf = async (user, poolId = 0) => (
            await this.cvp.balanceOf(user)).add(await this.lpMining.pendingCvp(poolId, user)
        ).toString();
    });

    beforeEach(async function () {
        this.snapshot = await createSnapshot();
    });

    afterEach(async function () {
        await revertToSnapshot(this.snapshot);
    });

    it('should set correct state variables', async () => {
        this.lpMining = await VestedLPMining.new(
            this.cvp.address, this.reservoir.address, '1000', '0', '100', { from: minter }
        );
        const cvp = await this.lpMining.cvp();
        assert.equal(cvp.valueOf(), this.cvp.address);
    });

    context('With ERC/LP token added to the field', () => {

        it('should allow emergency withdraw', async () => {
            // 100 per block farming rate starting at block 100 with 1 block vesting period
            this.lpMining = await VestedLPMining.new(
                this.cvp.address, this.reservoir.address, '100', '100', '100000', { from: minter }
            );
            await this.prepareReservoir();

            await this.lpMining.add('100', this.lp.address, '1', true, true, { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: bob });
            await this.lpMining.deposit(0, '100', { from: bob });
            assert.equal((await this.lp.balanceOf(bob)).toString(), '900');
            await this.lpMining.emergencyWithdraw(0, { from: bob });
            assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');
        });

        it('should give out CVPs only after farming time', async () => {
            // 100 per block farming rate starting at block 100 with 50 block vesting period
            this.lpMining = await VestedLPMining.new(
                this.cvp.address, this.reservoir.address, '100', '100',  '50', { from: minter }
            );
            await this.prepareReservoir();

            await this.lpMining.add('100', this.lp.address, '1', true, true, { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: bob });
            await this.lpMining.deposit(0, '100', { from: bob });
            await time.advanceBlockTo('89');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 90
            assert.equal(await this.allCvpOf(bob), '0');
            await time.advanceBlockTo('94');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 95
            assert.equal(await this.allCvpOf(bob), '0');
            await time.advanceBlockTo('99');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 100
            assert.equal(await this.allCvpOf(bob), '0');
            await time.advanceBlockTo('100');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 101
            assert.equal(await this.allCvpOf(bob), '100');
            await time.advanceBlockTo('104');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 105
            assert.equal(await this.allCvpOf(bob), '500');
        });

        it('should not distribute CVPs if no one deposit', async () => {
            // 100 per block farming rate starting at block 200 with 50 block vesting period
            this.lpMining = await VestedLPMining.new(
                this.cvp.address, this.reservoir.address, '100', '200',  '50', { from: minter }
            );
            await this.prepareReservoir();

            await this.lpMining.add('100', this.lp.address, '1', true, true, { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: bob });
            await time.advanceBlockTo('199');
            assert.equal(
                await this.cvpBalanceOf(this.reservoir.address),
                this.reservoirInitialBalance.toString()
            );
            await time.advanceBlockTo('204');
            assert.equal(
                await this.cvpBalanceOf(this.reservoir.address),
                this.reservoirInitialBalance.toString()
            );
            await time.advanceBlockTo('209');
            await this.lpMining.deposit(0, '10', { from: bob }); // block 210
            assert.equal(
                await this.cvpBalanceOf(this.reservoir.address),
                this.reservoirInitialBalance.toString()
            );
            assert.equal(await this.cvpBalanceOf(bob), '0');
            assert.equal((await this.lp.balanceOf(bob)).toString(), '990');
            await time.advanceBlockTo('219');
            await this.lpMining.withdraw(0, '10', { from: bob }); // block 220
            assert.equal((await this.lp.balanceOf(bob)).toString(), '1000');
            const pendingCvp = (await this.lpMining.cvpVestingPool()).toString();
            await this.checkCvpSpent('1000', pendingCvp);
            assert.equal(await this.allCvpOf(bob), '1000');
        });

        it('should distribute CVPs properly for each staker', async () => {
            // 100 per block farming rate starting at block 300
            this.lpMining = await VestedLPMining.new(
                this.cvp.address, this.reservoir.address, '100', '300',  '100', { from: minter }
            );
            await this.prepareReservoir();

            await this.lpMining.add('100', this.lp.address, '1', true, true, { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: alice });
            await this.lp.approve(this.lpMining.address, '1000', { from: bob });
            await this.lp.approve(this.lpMining.address, '1000', { from: carol });
            // Alice deposits 10 LPs at block 310
            await time.advanceBlockTo('309');
            await this.lpMining.deposit(0, '10', { from: alice });
            // Bob deposits 20 LPs at block 314
            await time.advanceBlockTo('313');
            await this.lpMining.deposit(0, '20', { from: bob });
            // Carol deposits 30 LPs at block 318
            await time.advanceBlockTo('317');
            await this.lpMining.deposit(0, '30', { from: carol });
            // Alice deposits 10 more LPs at block 320. At this point:
            //   Alice should have: 4*100 + 4*1/3*100 + 2*1/6*100 = 566
            //   VestedLPMining should have the remaining: 10000 - 566 = 9434
            await time.advanceBlockTo('319')
            await this.lpMining.deposit(0, '10', { from: alice });
            const pendingCvp = (await this.lpMining.cvpVestingPool()).toString();
            await this.checkCvpSpent('1000', pendingCvp);
            assert.equal(await this.allCvpOf(alice), '566');
            assert.equal(await this.cvpBalanceOf(bob), '0');
            assert.equal(await this.cvpBalanceOf(carol), '0');
            // Bob withdraws 5 LPs at block 330. At this point:
            //   Bob should have: 4*2/3*100 + 2*2/6*100 + 10*2/7*100 = 619
            await time.advanceBlockTo('329')
            await this.lpMining.withdraw(0, '5', { from: bob });
            const pendingCvp2 = (await this.lpMining.cvpVestingPool()).toString();
            await this.checkCvpSpent('2000', pendingCvp2);
            assert.equal(await this.allCvpOf(bob), '619');
            assert.equal(await this.cvpBalanceOf(carol), '0');
            // Alice withdraws 20 LPs at block 340.
            // Bob withdraws 15 LPs at block 350.
            // Carol withdraws 30 LPs at block 360.
            await time.advanceBlockTo('339')
            await this.lpMining.withdraw(0, '20', { from: alice });
            await time.advanceBlockTo('349')
            await this.lpMining.withdraw(0, '15', { from: bob });
            await time.advanceBlockTo('359')
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
            // 252 vested, 907 pending, of the latest - 203 may be vested at block 360
            assert.equal(`${(await this.cvp.balanceOf.call(alice)).toString()}`, '252');
            assert.equal(`${(await this.lpMining.pendingCvp.call(0, alice)).toString()}`, '907');
            assert.equal(`${(await this.lpMining.vestableCvp.call(0, alice)).toString()}`, '203');
            // Out of 1183, Bob should have:
            // 285 vested, 898 pending, of the latest - 100 may be vested at block 360
            assert.equal(`${(await this.cvp.balanceOf.call(bob)).toString()}`, '285');
            assert.equal(`${(await this.lpMining.pendingCvp.call(0, bob)).toString()}`, '898');
            assert.equal(`${(await this.lpMining.vestableCvp.call(0, bob)).toString()}`, '100');
            // Out of 2657, Carol should have:
            // 785 vested, 1872 pending, of the latest - nothing may be vested at block 360
            assert.equal(`${(await this.cvp.balanceOf.call(carol)).toString()}`, '785');
            assert.equal(`${(await this.lpMining.pendingCvp.call(0, carol)).toString()}`, '1872');
            assert.equal(`${(await this.lpMining.vestableCvp.call(0, carol)).toString()}`, '0');

            // Alice withdraws 214 at block 361 (203 at block 360 + 11 newly released)
            await this.lpMining.withdraw(0, '0', { from: alice }); // block 361
            assert.equal(await this.cvpBalanceOf(alice), '466');

            // In 100 blocks after the withdrawal, the entire amount is vested.
            await time.advanceBlockTo('439')
            await this.lpMining.withdraw(0, '0', { from: alice });
            assert.equal(await this.cvpBalanceOf(alice), '1159');
            await time.advanceBlockTo('449')
            await this.lpMining.withdraw(0, '0', { from: bob });
            assert.equal(await this.cvpBalanceOf(bob), '1183');
            await time.advanceBlockTo('459')
            await this.lpMining.withdraw(0, '0', { from: carol });
            assert.equal(await this.cvpBalanceOf(carol), '2657');
            assert.equal((await this.lpMining.cvpVestingPool()).toString() * 1 <= 1, true);
        });

        it('should give proper CVPs allocation to each pool', async () => {
            // 100 per block farming rate starting at block 400
            this.lpMining = await VestedLPMining.new(
                this.cvp.address, this.reservoir.address, '100', '400',  '100', { from: minter }
            );
            await this.prepareReservoir();

            await this.lp.approve(this.lpMining.address, '1000', { from: alice });
            await this.lp2.approve(this.lpMining.address, '1000', { from: bob });

            assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), false);
            // Add first LP to the pool with allocation 1
            await this.lpMining.add('10', this.lp.address, '1', true, true, { from: minter });
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
            assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');

            // Alice deposits 10 LPs at block 410
            await time.advanceBlockTo('409');
            await this.lpMining.deposit(0, '10', { from: alice });

            await expectRevert(
                this.lpMining.add('10', this.lp.address, '1', true, true, { from: minter }),
                'VestedLPMining: LP token already added'
            );

            // Add LP2 to the pool with allocation 2 at block 420
            await time.advanceBlockTo('419');
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), false);
            await this.lpMining.add('20', this.lp2.address, '1', true, true, { from: minter });
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
            assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), true);
            assert.equal(await this.lpMining.poolPidByAddress(this.lp2.address), '1');
            // Alice should have 10*1000 pending reward
            assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1000');
            // Bob deposits 10 LP2s at block 425
            await time.advanceBlockTo('424');
            await this.lpMining.deposit(1, '5', { from: bob });
            // Alice should have 1000 + 5*1/3*1000 = 2666 pending reward
            assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1166');
            await time.advanceBlockTo('430');
            // At block 430. Bob should get 5*2/3*1000 = 3333. Alice should get ~1666 more.
            assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1333');
            assert.equal((await this.lpMining.pendingCvp(1, bob)).toString(), '333');

            this.lp3 = await MockERC20.new('LPToken3', 'LP3', '10000000000', { from: minter });
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp3.address), false);
            await this.lpMining.add('20', this.lp3.address, '1', true, true, { from: minter });
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp.address), true);
            assert.equal(await this.lpMining.poolPidByAddress(this.lp.address), '0');
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), true);
            assert.equal(await this.lpMining.poolPidByAddress(this.lp2.address), '1');
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp3.address), true);
            assert.equal(await this.lpMining.poolPidByAddress(this.lp3.address), '2');

            this.lp4 = await MockERC20.new('LPToken4', 'LP4', '10000000000', { from: minter });
            assert.equal(await this.lpMining.isLpTokenAdded(this.lp4.address), false);
            await this.lpMining.add('20', this.lp4.address, '1', true, true, { from: minter });
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
            this.lpMining = await VestedLPMining.new(
                this.cvp.address, this.reservoir.address, '100', '500',  '100', { from: minter }
            );
            await this.prepareReservoir();

            await this.lp.approve(this.lpMining.address, '1000', { from: alice });
            await this.lpMining.add('1', this.lp.address, '1', true, true, { from: minter });
            // Alice deposits 10 LPs at block 590
            await time.advanceBlockTo('589');
            await this.lpMining.deposit(0, '10', { from: alice });
            // At block 605, she should have 100*15 = 1500 pending.
            await time.advanceBlockTo('605');
            assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1500');
            // At block 606, Alice withdraws all pending rewards and should get 1600.
            await this.lpMining.deposit(0, '0', { from: alice });
            // out of 1600, 1380 still pend to be vested and 220 sent to her wallet
            assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1380');
            assert.equal(await this.cvpBalanceOf(alice), '220');
        });

        it('should correctly checkpoint votes', async () => {
            // 100 per block farming rate starting at block 700
            await time.advanceBlockTo('699');
            this.lpMining = await VestedLPMining.new(
                this.cvp.address, this.reservoir.address, '100', '700', '100', { from: minter }
            );
            await this.prepareReservoir();

            await this.cvp.transfer(this.lp.address, '5000000000', { from: minter });
            await this.lp.transfer(alice, '1000', { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: alice });

            await this.lpMining.add('1', this.lp.address, '1', true, true, { from: minter });

            // Alice deposits 10 LPs at block 790
            await time.advanceBlockTo('789');
            await this.lpMining.deposit(0, '10', { from: alice });
            // console.log('logs', logs.map(e => e.args));
            const firstBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
            // At block 805, she should have 100*15 = 1500 pending.
            await time.advanceBlockTo('805');
            assert.equal((await this.lpMining.pendingCvp(0, alice)).toString(), '1500');

            await this.lpMining.deposit(0, '10', { from: alice });
            const secondBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '10');

            await this.lpMining.deposit(0, '40', { from: alice });
            const thirdBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '30');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '30');

            await this.lpMining.withdraw(0, '10', { from: alice });
            const fourthBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '25');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '30');
            assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '25');

            await this.cvp.transfer(this.lp.address, '5000000000', { from: minter });
            await this.lpMining.checkpointVotes(alice);
            const fifthBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '50');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '30');
            assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '25');
            assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).toString(), '50');

            await this.cvp.transfer(this.lp2.address, '5000000000', { from: minter });
            await this.lp2.transfer(alice, '1000', { from: minter });
            await this.lp2.approve(this.lpMining.address, '1000', { from: alice });

            await this.lpMining.add('1', this.lp2.address, '1', true, true, { from: minter });
            await this.lpMining.deposit('1', '10', { from: alice });
            const sixthBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '55');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '30');
            assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '25');
            assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).toString(), '50');
            assert.equal((await this.lpMining.getPriorVotes(alice, sixthBlockNumber)).toString(), '55');

            await this.lpMining.checkpointVotes(alice);
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '55');

            await this.lpMining.emergencyWithdraw(0, { from: alice });
            const seventhBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '30');
            assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '25');
            assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).toString(), '50');
            assert.equal((await this.lpMining.getPriorVotes(alice, seventhBlockNumber)).toString(), '5');

            await this.lpMining.checkpointVotes(alice);
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '5');

            await this.lpMining.set(1, '1', '1', false, true, { from: minter });
            await this.lpMining.checkpointVotes(alice);
            const eighthBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).toString(), '0');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).toString(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).toString(), '30');
            assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).toString(), '25');
            assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).toString(), '50');
            assert.equal((await this.lpMining.getPriorVotes(alice, seventhBlockNumber)).toString(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, eighthBlockNumber)).toString(), '0');
        });

        it('cvpPerBlock can be changed by owner', async () => {
            await time.advanceBlockTo('899');
            // 100 per block farming rate starting at block 900
            this.lpMining = await VestedLPMining.new(
                this.cvp.address, this.reservoir.address, '100', '900', '100', { from: minter }
            );
            await this.prepareReservoir();

            await this.lp.approve(this.lpMining.address, '1000', { from: bob });
            await time.advanceBlockTo('909');
            await this.lpMining.add('100', this.lp.address, '1', true, true, { from: minter });
            await this.lpMining.deposit(0, '100', { from: bob });
            await time.advanceBlockTo('919');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 920
            assert.equal(await this.allCvpOf(bob), '900');

            await expectRevert(
                this.lpMining.setCvpPerBlock('200', { from: alice }),
                'Ownable: caller is not the owner'
            );
            await this.lpMining.setCvpPerBlock('200', { from: minter });

            await time.advanceBlockTo('929');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 930
            assert.equal(await this.allCvpOf(bob), '2900');
        });
    });
});
