const { expectRevert, time } = require('@openzeppelin/test-helpers');
const CvpToken = artifacts.require('MockCvp');
const LPMining = artifacts.require('LPMining');
const MockERC20 = artifacts.require('MockERC20');
const Reservoir = artifacts.require('Reservoir');

const {web3} = Reservoir;
const {toBN} = web3.utils;

contract('LPMining', ([alice, bob, carol, dev, minter]) => {
    let supply;
    let reservoirInitialBalance;
    beforeEach(async () => {
        this.cvp = await CvpToken.new({ from: minter });
        this.reservoir = await Reservoir.new({ from: minter });

        this.prepareReservoir = async function() {
            supply = await this.cvp.totalSupply();
            reservoirInitialBalance = toBN(supply).div(toBN('2'));
            await this.cvp.transfer(this.reservoir.address, reservoirInitialBalance, { from: minter });
            await this.reservoir.setApprove(this.cvp.address, this.lpMining.address, supply, { from: minter });
        };

        this.checkCvpSpent = async function(spentValue) {
            const reservoirBalance = await this.cvp.balanceOf(this.reservoir.address);
            assert.equal(toBN(reservoirInitialBalance).sub(toBN(reservoirBalance)).toString(10), toBN(spentValue).toString(10))
        };
    });

    it('should set correct state variables', async () => {
        this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '1000', '0', '1000', { from: minter });
        await this.prepareReservoir();
        const cvp = await this.lpMining.cvp();
        const devaddr = await this.lpMining.devaddr();
        assert.equal(cvp.valueOf(), this.cvp.address);
        assert.equal(devaddr.valueOf(), dev);
    });

    it('should allow dev and only dev to update dev', async () => {
        this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '1000', '0', '1000', { from: minter });
        assert.equal((await this.lpMining.devaddr()).valueOf(), dev);
        await expectRevert(this.lpMining.dev(bob, { from: bob }), 'dev: wut?');
        await this.lpMining.dev(bob, { from: dev });
        assert.equal((await this.lpMining.devaddr()).valueOf(), bob);
        await this.lpMining.dev(alice, { from: bob });
        assert.equal((await this.lpMining.devaddr()).valueOf(), alice);
    })

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
            // 100 per block farming rate starting at block 100 with bonus until block 1000
            this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '100', '100', '1000', { from: minter });
            await this.lpMining.add('100', this.lp.address, true, { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: bob });
            await this.lpMining.deposit(0, '100', { from: bob });
            assert.equal((await this.lp.balanceOf(bob)).valueOf(), '900');
            await this.lpMining.emergencyWithdraw(0, { from: bob });
            assert.equal((await this.lp.balanceOf(bob)).valueOf(), '1000');
        });

        it('should give out CVPs only after farming time', async () => {
            // 100 per block farming rate starting at block 100 with bonus until block 1000
            this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '100', '100', '1000', { from: minter });
            await this.prepareReservoir();
            await this.lpMining.add('100', this.lp.address, true, { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: bob });
            await this.lpMining.deposit(0, '100', { from: bob });
            await time.advanceBlockTo('89');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 90
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
            await time.advanceBlockTo('94');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 95
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
            await time.advanceBlockTo('99');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 100
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
            await time.advanceBlockTo('100');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 101
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '1000');
            await time.advanceBlockTo('104');
            await this.lpMining.deposit(0, '0', { from: bob }); // block 105
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '5000');
            assert.equal((await this.cvp.balanceOf(dev)).valueOf(), '500');
        });

        it('should not distribute CVPs if no one deposit', async () => {
            // 100 per block farming rate starting at block 200 with bonus until block 1000
            this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '100', '200', '1000', { from: minter });
            await this.prepareReservoir();
            await this.lpMining.add('100', this.lp.address, true, { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: bob });
            await time.advanceBlockTo('199');
            assert.equal((await this.cvp.balanceOf(this.reservoir.address)).toString(10), reservoirInitialBalance.toString(10));
            await time.advanceBlockTo('204');
            assert.equal((await this.cvp.balanceOf(this.reservoir.address)).toString(10), reservoirInitialBalance.toString(10));
            await time.advanceBlockTo('209');
            await this.lpMining.deposit(0, '10', { from: bob }); // block 210
            assert.equal((await this.cvp.balanceOf(this.reservoir.address)).toString(10), reservoirInitialBalance.toString(10));
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
            assert.equal((await this.cvp.balanceOf(dev)).valueOf(), '0');
            assert.equal((await this.lp.balanceOf(bob)).valueOf(), '990');
            await time.advanceBlockTo('219');
            await this.lpMining.withdraw(0, '10', { from: bob }); // block 220
            await this.checkCvpSpent('11000');
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '10000');
            assert.equal((await this.cvp.balanceOf(dev)).valueOf(), '1000');
            assert.equal((await this.lp.balanceOf(bob)).valueOf(), '1000');
        });

        it('should distribute CVPs properly for each staker', async () => {
            // 100 per block farming rate starting at block 300 with bonus until block 1000
            this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '100', '300', '1000', { from: minter });
            await this.prepareReservoir();
            await this.lpMining.add('100', this.lp.address, true, { from: minter });
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
            //   Alice should have: 4*1000 + 4*1/3*1000 + 2*1/6*1000 = 5666
            //   LPMining should have the remaining: 10000 - 5666 = 4334
            await time.advanceBlockTo('319')
            await this.lpMining.deposit(0, '10', { from: alice });
            await this.checkCvpSpent('11000');
            assert.equal((await this.cvp.balanceOf(alice)).valueOf(), '5666');
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '0');
            assert.equal((await this.cvp.balanceOf(carol)).valueOf(), '0');
            assert.equal((await this.cvp.balanceOf(this.lpMining.address)).valueOf(), '4334');
            assert.equal((await this.cvp.balanceOf(dev)).valueOf(), '1000');
            // Bob withdraws 5 LPs at block 330. At this point:
            //   Bob should have: 4*2/3*1000 + 2*2/6*1000 + 10*2/7*1000 = 6190
            await time.advanceBlockTo('329')
            await this.lpMining.withdraw(0, '5', { from: bob });
            await this.checkCvpSpent('22000');
            assert.equal((await this.cvp.balanceOf(alice)).valueOf(), '5666');
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '6190');
            assert.equal((await this.cvp.balanceOf(carol)).valueOf(), '0');
            assert.equal((await this.cvp.balanceOf(this.lpMining.address)).valueOf(), '8144');
            assert.equal((await this.cvp.balanceOf(dev)).valueOf(), '2000');
            // Alice withdraws 20 LPs at block 340.
            // Bob withdraws 15 LPs at block 350.
            // Carol withdraws 30 LPs at block 360.
            await time.advanceBlockTo('339')
            await this.lpMining.withdraw(0, '20', { from: alice });
            await time.advanceBlockTo('349')
            await this.lpMining.withdraw(0, '15', { from: bob });
            await time.advanceBlockTo('359')
            await this.lpMining.withdraw(0, '30', { from: carol });
            await this.checkCvpSpent('55000');
            assert.equal((await this.cvp.balanceOf(dev)).valueOf(), '5000');
            // Alice should have: 5666 + 10*2/7*1000 + 10*2/6.5*1000 = 11600
            assert.equal((await this.cvp.balanceOf(alice)).valueOf(), '11600');
            // Bob should have: 6190 + 10*1.5/6.5 * 1000 + 10*1.5/4.5*1000 = 11831
            assert.equal((await this.cvp.balanceOf(bob)).valueOf(), '11831');
            // Carol should have: 2*3/6*1000 + 10*3/7*1000 + 10*3/6.5*1000 + 10*3/4.5*1000 + 10*1000 = 26568
            assert.equal((await this.cvp.balanceOf(carol)).valueOf(), '26568');
            // All of them should have 1000 LPs back.
            assert.equal((await this.lp.balanceOf(alice)).valueOf(), '1000');
            assert.equal((await this.lp.balanceOf(bob)).valueOf(), '1000');
            assert.equal((await this.lp.balanceOf(carol)).valueOf(), '1000');
        });

        it('should give proper CVPs allocation to each pool', async () => {
            // 100 per block farming rate starting at block 400 with bonus until block 1000
            this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '100', '400', '1000', { from: minter });
            await this.prepareReservoir();
            await this.lp.approve(this.lpMining.address, '1000', { from: alice });
            await this.lp2.approve(this.lpMining.address, '1000', { from: bob });
            // Add first LP to the pool with allocation 1
            await this.lpMining.add('10', this.lp.address, true, { from: minter });
            // Alice deposits 10 LPs at block 410
            await time.advanceBlockTo('409');
            await this.lpMining.deposit(0, '10', { from: alice });
            // Add LP2 to the pool with allocation 2 at block 420
            await time.advanceBlockTo('419');
            await this.lpMining.add('20', this.lp2.address, true, { from: minter });
            // Alice should have 10*1000 pending reward
            assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf(), '10000');
            // Bob deposits 10 LP2s at block 425
            await time.advanceBlockTo('424');
            await this.lpMining.deposit(1, '5', { from: bob });
            // Alice should have 10000 + 5*1/3*1000 = 11666 pending reward
            assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf(), '11666');
            await time.advanceBlockTo('430');
            // At block 430. Bob should get 5*2/3*1000 = 3333. Alice should get ~1666 more.
            assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf(), '13333');
            assert.equal((await this.lpMining.pendingCvp(1, bob)).valueOf(), '3333');
        });

        it('should stop giving bonus CVPs after the bonus period ends', async () => {
            // 100 per block farming rate starting at block 500 with bonus until block 600
            this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '100', '500', '600', { from: minter });
            await this.prepareReservoir();
            await this.lp.approve(this.lpMining.address, '1000', { from: alice });
            await this.lpMining.add('1', this.lp.address, true, { from: minter });
            // Alice deposits 10 LPs at block 590
            await time.advanceBlockTo('589');
            await this.lpMining.deposit(0, '10', { from: alice });
            // At block 605, she should have 1000*10 + 100*5 = 10500 pending.
            await time.advanceBlockTo('605');
            assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf(), '10500');
            // At block 606, Alice withdraws all pending rewards and should get 10600.
            await this.lpMining.deposit(0, '0', { from: alice });
            assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf(), '0');
            assert.equal((await this.cvp.balanceOf(alice)).valueOf(), '10600');
        });

        it('should correctly checkpoint votes', async () => {
            // 100 per block farming rate starting at block 700 with bonus until block 800
            await time.advanceBlockTo('699');
            this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, dev, '100', '700', '800', { from: minter });
            await this.prepareReservoir();

            await this.cvp.transfer(this.lp.address, '5000000000', { from: minter });
            await this.lp.transfer(alice, '1000', { from: minter });
            await this.lp.approve(this.lpMining.address, '1000', { from: alice });

            await this.lpMining.add('1', this.lp.address, true, { from: minter });

            // Alice deposits 10 LPs at block 790
            await time.advanceBlockTo('789');
            await this.lpMining.deposit(0, '10', { from: alice });
            // console.log('logs', logs.map(e => e.args));
            const firstBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
            // At block 805, she should have 1000*10 + 100*5 = 10500 pending.
            await time.advanceBlockTo('805');
            assert.equal((await this.lpMining.pendingCvp(0, alice)).valueOf().toString(10), '10500');

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
            await this.lpMining.checkpointVotes('0', alice);
            const fifthBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '50');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).valueOf(), '30');
            assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).valueOf(), '25');
            assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).valueOf(), '50');

            await this.lpMining.emergencyWithdraw(0, { from: alice });
            const sixthBlockNumber = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            assert.equal((await this.lpMining.getCurrentVotes(alice)).valueOf(), '0');
            assert.equal((await this.lpMining.getPriorVotes(alice, firstBlockNumber)).valueOf(), '5');
            assert.equal((await this.lpMining.getPriorVotes(alice, secondBlockNumber)).valueOf(), '10');
            assert.equal((await this.lpMining.getPriorVotes(alice, thirdBlockNumber)).valueOf(), '30');
            assert.equal((await this.lpMining.getPriorVotes(alice, fourthBlockNumber)).valueOf(), '25');
            assert.equal((await this.lpMining.getPriorVotes(alice, fifthBlockNumber)).valueOf(), '50');
            assert.equal((await this.lpMining.getPriorVotes(alice, sixthBlockNumber)).valueOf(), '0');
        });
    });
});
