/* global after, afterEach, artifacts, assert, before, beforeEach, context, contract, describe, it, web3 */
const { appendFileSync } = require('fs');
const DEBUG_LOG = (msg) => appendFileSync('.debug-log.txt', `*** DEBUG (${(new Date()).toLocaleTimeString()}): ${msg}\n`);

const { time } = require('@openzeppelin/test-helpers');
const { createSnapshot, revertToSnapshot } = require('./helpers/blockchain');
const MockVestedLPMiningMath = artifacts.require('MockVestedLPMiningMath');

const {toBN} = web3.utils;

contract('VestedLPMining (internal math)', ([ , deployer, doesNotMatter ]) => {
    const e18 = '000000000000000000';
    const e6 = '000000';
    const Scale = toBN((1e12).toString());

    const cvpPerBlock = '1'+e6;
    const vestPeriod = '10'; // in blocks

    const mockLptBalance = toBN('200'+e18);
    const mockTotalAllocPoint = toBN('2000');

    const defTxOpts = { from: deployer };

    before(async () => {
        this.startBlock = await web3.eth.getBlockNumber();
        this.vestingMath = await MockVestedLPMiningMath.new(
            doesNotMatter,
            doesNotMatter,
            cvpPerBlock,
            this.startBlock,
            vestPeriod,
            defTxOpts,
        );
        await this.vestingMath._setMockParams(mockLptBalance.toString(), mockTotalAllocPoint.toString());
        this.deployBlock = await web3.eth.getBlockNumber();
    });

    beforeEach(async function () {
        this.snapshot = await createSnapshot();
    });

    afterEach(async function () {
        await revertToSnapshot(this.snapshot);
    });

    context('computePoolReward function', () => {

        it('should return zero reward params computed for zero allocation points', async () => {
            const [ allocPoint, lastUpdateBlock, accCvpPerLpt, cvpBalance ] = [ '0', '0', '0', '0' ];

            await time.advanceBlockTo('50');
            const tx = await this.vestingMath._computePoolReward(allocPoint, lastUpdateBlock, accCvpPerLpt, cvpBalance);
            const res = tx.receipt.logs[0].args;
            const curBlock = await web3.eth.getBlockNumber();

            assert(this.deployBlock.toString() !== curBlock.toString());
            assert.equal(res.lastUpdateBlock.toString(), curBlock.toString());
            assert.equal(res.accCvpPerLpt.toString(), '0');
            assert.equal(res.cvpBalance.toString(), '0');
        });

        it('should return non-zero reward params computed for non-zero allocation points', async () => {
            const [ allocPoint, lastUpdateBlock, accCvpPerLpt, cvpBalance ] = [ '1000', '10', '0', '0' ];
            const eCvpBalance = toBN(cvpPerBlock).mul(toBN('50')).div(mockTotalAllocPoint).mul(toBN(allocPoint));
            const eAccCvpPerLpt = eCvpBalance.mul(Scale).div(mockLptBalance);

            await time.advanceBlockTo('59');
            const tx = await this.vestingMath._computePoolReward(allocPoint, lastUpdateBlock, accCvpPerLpt, cvpBalance);
            const res = tx.receipt.logs[0].args;

            assert.equal(res.lastUpdateBlock.toString(), '60');
            assert.equal(res.accCvpPerLpt.toString(), eAccCvpPerLpt);
            assert.equal(res.cvpBalance.toString(), eCvpBalance);
        });

        it('should return computed reward params being "called"', async () => {
            const [ allocPoint, lastUpdateBlock, accCvpPerLpt, cvpBalance ] = [ '1000', '10', '3'+e6, '10'+e6 ];
            const eCvpBalance = toBN(cvpBalance).add(
                toBN(cvpPerBlock).mul(toBN('50')).div(mockTotalAllocPoint).mul(toBN(allocPoint))
            );
            const eAccCvpPerLpt = toBN(accCvpPerLpt).add(
                eCvpBalance.mul(Scale).div(mockLptBalance)
            );

            await time.advanceBlockTo('60');
            const res = await this.vestingMath
                ._computePoolReward.call(allocPoint, lastUpdateBlock, accCvpPerLpt, cvpBalance);

            assert.equal(res.lastUpdateBlock.toString(), '60');
            assert.equal(res.accCvpPerLpt.toString(), eAccCvpPerLpt);
            assert.equal(res.cvpBalance.toString(), eCvpBalance);
        });
    });

    context('computeCvpVesting function', () => {
        const getTestUser = () => ({
            lptAmount: '20' + e18,
            cvpAdjust: '0',
            entitledCvp: '5' + e6,
            vestedCvp: '5' + e6,
            vestingBlock: '30',
            lastUpdateBlock: '30',
        });
        const accCvpPerLpt = '1' + e6;
    // newlyEntitled, newlyVested, cvpAdjust, entitledCvp, vestedCvp, vestingBlock, lastUpdateBlock
        context('with all CVPs vested on the latest deposit/withdrawal', () => {
            it('should return zero vesting params computed for zero LPT balance', async () => {
                const user = getTestUser();
                user.lptAmount = '0';

                await time.advanceBlockTo('49');
                const tx = await this.vestingMath._computeCvpVesting(user, accCvpPerLpt); // new block mined
                const res = tx.receipt.logs[0].args;
                DEBUG_LOG(JSON.stringify(res));

                assert.equal(res.lastUpdateBlock.toString(), '50');
                // new CVPs neither entitled nor vested
                assert.equal(res.newlyEntitled.toString(), '0');
                assert.equal(res.newlyVested.toString(), '0');
                // therefore other params remain unchanged
                assert.equal(res.cvpAdjust.toString(), user.cvpAdjust);
                assert.equal(res.entitledCvp.toString(), user.entitledCvp);
                assert.equal(res.vestedCvp.toString(), user.vestedCvp);
            });

            it('should vest CVPs vested before even if the LPT balance is zero now', async () => {
                const user = getTestUser();
                user.lptAmount = '0';
                user.vestedCvp = '3'+e6;
                user.vestingBlock = '35';

                await time.advanceBlockTo('49');
                const tx = await this.vestingMath._computeCvpVesting(user, accCvpPerLpt); // new block mined
                const res = tx.receipt.logs[0].args;
                DEBUG_LOG(JSON.stringify(res));

                assert.equal(res.lastUpdateBlock.toString(), '50');
                // no new CVPs entitled
                assert.equal(res.newlyEntitled.toString(), '0');
                assert.equal(res.entitledCvp.toString(), user.entitledCvp);
                // but remaining CVPs vested
                assert.equal(res.newlyVested.toString(), '2' + e6);
                // assert.equal(res.cvpAdjust.toString(), user.cvpAdjust);
                assert.equal(res.vestedCvp.toString(), '5' + e6);
            });
        });
    });
});
