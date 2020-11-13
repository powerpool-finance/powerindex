const { time } = require('@openzeppelin/test-helpers');
const { createSnapshot, revertToSnapshot } = require('./helpers/blockchain');
const assert = require('chai').assert;
const MockVestedLPMiningMath = artifacts.require('MockVestedLPMiningMath');

const { toBN } = web3.utils;

describe('VestedLPMining (internal math)', () => {
  let deployer, doesNotMatter;
  before(async function () {
    [, deployer, doesNotMatter] = await web3.eth.getAccounts();
  });

  const e18 = '000000000000000000';
  const Scale = toBN((1e12).toString());

  const cvpPerBlock = `${1e6}`;
  const vestPeriod = '10'; // in blocks

  const mockLptBalance = toBN('200' + e18);
  const mockTotalAllocPoint = toBN('2000');

  const defTxOpts = { from: deployer };

  before(async () => {
    this.startBlock = await web3.eth.getBlockNumber();
    this.vestingMath = await MockVestedLPMiningMath.new();
    await this.vestingMath.initialize(
      this.vestingMath.address,
      doesNotMatter,
      cvpPerBlock,
      this.startBlock,
      vestPeriod,
      defTxOpts,
    );
    await this.vestingMath._setMockParams(mockLptBalance.toString(), mockTotalAllocPoint.toString());
    this.deployBlock = await web3.eth.getBlockNumber();
    this.shiftBlock = blockNum => `${1 * this.startBlock + 1 * blockNum}`;
  });

  beforeEach(async function () {
    this.snapshot = await createSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(this.snapshot);
  });

  context('computePoolReward function', () => {
    it('should return zero reward params computed for zero allocation points', async () => {
      const [allocPoint, lastUpdateBlock, accCvpPerLpt] = ['0', this.shiftBlock('0'), '0'];

      await time.advanceBlockTo(this.shiftBlock('50'));
      const tx = await this.vestingMath.__computePoolReward(allocPoint, lastUpdateBlock, accCvpPerLpt);
      const res = tx.receipt.logs[0].args;
      const curBlock = await web3.eth.getBlockNumber();

      assert(this.deployBlock.toString() !== curBlock.toString());
      assert.equal(res.lastUpdateBlock.toString(), curBlock.toString());
      assert.equal(res.accCvpPerLpt.toString(), '0');
      assert.equal(res.cvpReward.toString(), '0');
    });

    it('should return non-zero reward params computed for non-zero allocation points', async () => {
      const [allocPoint, lastUpdateBlock, accCvpPerLpt] = ['1000', this.shiftBlock('10'), '0'];
      const eCvpReward = toBN(cvpPerBlock).mul(toBN('50')).div(mockTotalAllocPoint).mul(toBN(allocPoint));
      const eAccCvpPerLpt = eCvpReward.mul(Scale).div(mockLptBalance);

      await time.advanceBlockTo(this.shiftBlock('59'));
      const tx = await this.vestingMath.__computePoolReward(allocPoint, lastUpdateBlock, accCvpPerLpt);
      const res = tx.receipt.logs[0].args;

      assert.equal(res.lastUpdateBlock.toString(), this.shiftBlock('60'));
      assert.equal(res.accCvpPerLpt.toString(), eAccCvpPerLpt.toString());
      assert.equal(res.cvpReward.toString(), eCvpReward.toString());
    });

    it('should return computed reward params being "called"', async () => {
      const [allocPoint, lastUpdateBlock, accCvpPerLpt] = ['1000', this.shiftBlock('10'), `${3e6}`];
      const eCvpReward = toBN(cvpPerBlock).mul(toBN('50')).div(mockTotalAllocPoint).mul(toBN(allocPoint));
      const eAccCvpPerLpt = toBN(accCvpPerLpt).add(eCvpReward.mul(Scale).div(mockLptBalance));

      await time.advanceBlockTo(this.shiftBlock('60'));
      const res = await this.vestingMath.__computePoolReward.call(allocPoint, lastUpdateBlock, accCvpPerLpt);

      assert.equal(res.lastUpdateBlock.toString(), this.shiftBlock('60'));
      assert.equal(res.accCvpPerLpt.toString(), eAccCvpPerLpt.toString());
      assert.equal(res.cvpReward.toString(), eCvpReward.toString());
    });
  });

  context('computeCvpVesting function', () => {
    const getTestUser = () => ({
      lptAmount: '20' + e18,
      cvpAdjust: '0',
      pendedCvp: '0',
      vestingBlock: this.shiftBlock('30'),
      lastUpdateBlock: this.shiftBlock('30'),
    });
    const accCvpPerLpt = `${0.2 * 10e6}`;

    context('with all CVPs vested on the latest deposit/withdrawal', () => {
      context('if the LPT balance has remained zero', () => {
        it('should nether entitle nor vest new CVPs', async () => {
          const user = getTestUser();
          user.lptAmount = '0';
          user.vestingBlock = this.shiftBlock('1');
          user.pendedCvp = '0';
          const currentBlock = this.shiftBlock('50');

          await time.advanceBlockTo(`${1 * currentBlock - 1}`);
          const tx = await this.vestingMath.__computeCvpVesting(user, accCvpPerLpt);
          const res = tx.receipt.logs[0].args;

          assert.equal(res.lastUpdateBlock.toString(), currentBlock);
          // new CVPs neither entitled nor vested
          assert.equal(res.newlyEntitled.toString(), '0');
          assert.equal(res.newlyVested.toString(), '0');
          // no CVPs remain pended
          assert.equal(res.pendedCvp.toString(), user.pendedCvp);
        });
      });

      context('if the LPT balance has not been zero', () => {
        it('should entitled and vest new CVPs proportionally to mined blocks', async () => {
          const user = getTestUser();
          user.lptAmount = '5' + e18;
          user.pendedCvp = '0';
          user.cvpAdjust = `${0.5e6}`;
          // less than `vestPeriod` since `user.lastUpdateBlock`
          const currentBlock = this.shiftBlock('35');

          const expectedEntitled = toBN(user.lptAmount).mul(toBN(accCvpPerLpt)).div(Scale).sub(toBN(user.cvpAdjust));

          const age = 1 * currentBlock - 1 * user.lastUpdateBlock;
          const expectedVesting = expectedEntitled.mul(toBN(`${age}`)).div(toBN(`${age + 1 * vestPeriod}`));

          await time.advanceBlockTo(`${1 * currentBlock - 1}`);
          const tx = await this.vestingMath.__computeCvpVesting(user, accCvpPerLpt);
          const res = tx.receipt.logs[0].args;

          assert.equal(res.lastUpdateBlock.toString(), currentBlock);
          // new CVPs entitled
          assert.equal(res.newlyEntitled.toString(), expectedEntitled.toString());
          // some of entitled CVPs get vested
          assert.equal(res.newlyVested.toString(), expectedVesting.toString());
          // only new CVPs entitled remain pended
          assert.equal(res.pendedCvp.toString(), expectedEntitled.sub(expectedVesting).toString());
          assert.equal(res.vestingBlock.toString(), `${1 * currentBlock + 1 * vestPeriod}`);
        });

        it('should vest newly entitled CVPs partially even if the vesting period past', async () => {
          const user = getTestUser();
          user.lptAmount = '5' + e18;
          user.cvpAdjust = `${0.5e6}`;
          user.pendedCvp = '0';
          // more than `vestPeriod` since `user.lastUpdateBlock`
          const currentBlock = this.shiftBlock('50');

          const expectedEntitled = toBN(user.lptAmount).mul(toBN(accCvpPerLpt)).div(Scale).sub(toBN(user.cvpAdjust));

          const age = 1 * currentBlock - 1 * user.lastUpdateBlock;
          const expectedVesting = expectedEntitled.mul(toBN(`${age}`)).div(toBN(`${age + 1 * vestPeriod}`));

          await time.advanceBlockTo(`${1 * currentBlock - 1}`);
          const tx = await this.vestingMath.__computeCvpVesting(user, accCvpPerLpt);
          const res = tx.receipt.logs[0].args;

          assert.equal(res.lastUpdateBlock.toString(), currentBlock);
          // new CVPs entitled
          assert.equal(res.newlyEntitled.toString(), expectedEntitled.toString());
          // all entitled CVPs get vested
          assert.equal(res.newlyVested.toString(), expectedVesting.toString());
          // only new CVPs entitled remain pending
          assert.equal(res.pendedCvp.toString(), expectedEntitled.sub(expectedVesting).toString());
          assert.equal(res.vestingBlock.toString(), `${1 * currentBlock + 1 * vestPeriod}`);
        });
      });
    });

    context('with CVPs pending since the last deposit/withdrawal', () => {
      context('if the LPT balance has remained zero', () => {
        it('should vest pending CVPs proportionally to mined blocks', async () => {
          const user = getTestUser();
          user.lptAmount = '0';
          user.pendedCvp = `${2e6}`;
          user.lastUpdateBlock = this.shiftBlock('30');
          user.vestingBlock = this.shiftBlock('38');
          // less than `user.vestingBlock`
          const currentBlock = this.shiftBlock('35');

          const expectedVesting = toBN(user.pendedCvp)
            .mul(toBN(`${1 * currentBlock - 1 * user.lastUpdateBlock}`))
            .div(toBN(`${1 * user.vestingBlock - 1 * user.lastUpdateBlock}`));

          await time.advanceBlockTo(`${1 * currentBlock - 1}`);
          const tx = await this.vestingMath.__computeCvpVesting(user, accCvpPerLpt);
          const res = tx.receipt.logs[0].args;

          assert.equal(res.lastUpdateBlock.toString(), currentBlock);
          // no new CVPs entitled
          assert.equal(res.newlyEntitled.toString(), '0');
          // but some "old" pended CVPs are vested
          assert.equal(res.newlyVested.toString(), expectedVesting.toString());
          assert.equal(res.pendedCvp.toString(), toBN(user.pendedCvp).sub(expectedVesting).toString());
          // only "old" pended CVPs remain pending with the same vesting block
          assert.equal(res.vestingBlock.toString(), `${user.vestingBlock}`);
        });

        it('should vest all remaining CVPs if the vesting period past', async () => {
          const user = getTestUser();
          user.lptAmount = '0';
          user.pendedCvp = `${2e6}`;
          user.vestingBlock = this.shiftBlock('35');
          // more than `vestPeriod` since `user.vestingBlock`
          const currentBlock = this.shiftBlock('50');

          await time.advanceBlockTo(`${1 * currentBlock - 1}`);
          const tx = await this.vestingMath.__computeCvpVesting(user, accCvpPerLpt);
          const res = tx.receipt.logs[0].args;

          assert.equal(res.lastUpdateBlock.toString(), currentBlock);
          // no new CVPs entitled
          assert.equal(res.newlyEntitled.toString(), '0');
          // but pended CVPs all get vested
          assert.equal(res.newlyVested.toString(), `${2e6}`);
          assert.equal(res.pendedCvp.toString(), '0');
          assert.equal(res.vestingBlock.toString(), 1 * currentBlock + 1 * vestPeriod);
        });
      });

      context('if the LPT balance has not been zero', () => {
        it('should entitle new CVPs and vest CVPs in proportion to mined blocks', async () => {
          const user = getTestUser();
          user.lptAmount = '2' + e18;
          user.pendedCvp = `${1e6}`;
          user.lastUpdateBlock = this.shiftBlock('30');
          user.vestingBlock = this.shiftBlock('38');
          user.cvpAdjust = `${0.5e6}`;
          // less than `user.vestingBlock`
          const currentBlock = this.shiftBlock('35');

          const pended = toBN(user.pendedCvp);
          const expectedEntitled = toBN(user.lptAmount).mul(toBN(accCvpPerLpt)).div(Scale).sub(toBN(user.cvpAdjust));
          const age = 1 * currentBlock - 1 * user.lastUpdateBlock;
          const entitledVesting = expectedEntitled.mul(toBN(`${age}`)).div(toBN(`${age + 1 * vestPeriod}`));
          const pendedVesting = pended
            .mul(toBN(`${1 * currentBlock - 1 * user.lastUpdateBlock}`))
            .div(toBN(`${1 * user.vestingBlock - 1 * user.lastUpdateBlock}`));
          const expectedVesting = entitledVesting.add(pendedVesting);
          const pendingPended = pended.sub(pendedVesting);
          const pendingEntitled = expectedEntitled.sub(entitledVesting);
          // weighted average between pending periods of "pended" and "entitled" CVPs
          const averageVestingPeriod = pendingPended
            .mul(toBN(`${1 * user.vestingBlock - 1 * currentBlock}`))
            .add(pendingEntitled.mul(toBN(vestPeriod)))
            .div(pendingPended.add(pendingEntitled))
            .toString();

          await time.advanceBlockTo(`${1 * currentBlock - 1}`);
          const tx = await this.vestingMath.__computeCvpVesting(user, accCvpPerLpt);
          const res = tx.receipt.logs[0].args;

          assert.equal(res.lastUpdateBlock.toString(), currentBlock);
          // new CVPs entitled
          assert.equal(res.newlyEntitled.toString(), expectedEntitled.toString());
          // a part of "new" CVPs and a part of "old" CVPs are vested
          assert.equal(res.newlyVested.toString(), expectedVesting.toString());
          assert.equal(res.pendedCvp.toString(), pended.add(expectedEntitled).sub(expectedVesting).toString());
          // new vesting block is between the old vesting block and `vestingPeriod` blocks from now
          assert.equal(1 * currentBlock + 1 * averageVestingPeriod > 1 * user.vestingBlock, true);
          assert.equal(1 * averageVestingPeriod < 1 * vestPeriod, true);
          assert.equal(res.vestingBlock.toString(), `${1 * currentBlock + 1 * averageVestingPeriod}`);
        });

        it('should vest entitled CVPs partially even if the vesting period past', async () => {
          const user = getTestUser();
          user.lptAmount = '2' + e18;
          user.pendedCvp = `${1e6}`;
          user.lastUpdateBlock = this.shiftBlock('30');
          user.vestingBlock = this.shiftBlock('38');
          user.cvpAdjust = `${0.5e6}`;
          // more than `user.vestingBlock`
          const currentBlock = this.shiftBlock('40');

          const expectedEntitled = toBN(user.lptAmount).mul(toBN(accCvpPerLpt)).div(Scale).sub(toBN(user.cvpAdjust));
          const age = 1 * currentBlock - 1 * user.lastUpdateBlock;
          const entitledVesting = expectedEntitled.mul(toBN(`${age}`)).div(toBN(`${age + 1 * vestPeriod}`));
          const pendedVesting = toBN(user.pendedCvp);
          const expectedVesting = entitledVesting.add(pendedVesting);

          await time.advanceBlockTo(`${1 * currentBlock - 1}`);
          const tx = await this.vestingMath.__computeCvpVesting(user, accCvpPerLpt);
          const res = tx.receipt.logs[0].args;

          assert.equal(res.lastUpdateBlock.toString(), currentBlock);
          // new CVPs entitled
          assert.equal(res.newlyEntitled.toString(), expectedEntitled.toString());
          // a part of "new" CVPs and a part of "old" CVPs are vested
          assert.equal(res.newlyVested.toString(), expectedVesting.toString());
          // only newly entitled CVPs remain pended with the vesting block in vesting period from now
          assert.equal(
            res.pendedCvp.toString(),
            toBN(user.pendedCvp).add(expectedEntitled).sub(expectedVesting).toString(),
          );
          assert.equal(res.vestingBlock.toString(), `${1 * currentBlock + 1 * vestPeriod}`);
        });
      });
    });

    it('should properly compute vesting for this case', async () => {
      const user = {
        lptAmount: '11861236796824068318',
        cvpAdjust: '85209598716746877357',
        pendedCvp: '582708476878859476035',
        vestingBlock: this.shiftBlock('402638'),
        lastUpdateBlock: this.shiftBlock('0'),
      };
      const currentBlock = this.shiftBlock('175');
      const accCvpPerLpt = '7362639340680';

      const expectedEntitled = toBN(user.lptAmount).mul(toBN(accCvpPerLpt)).div(Scale).sub(toBN(user.cvpAdjust));
      const age = 1 * currentBlock - 1 * user.lastUpdateBlock;
      const entitledVesting = expectedEntitled.mul(toBN(`${age}`)).div(toBN(`${age + 1 * vestPeriod}`));
      const pendedVesting = toBN(user.pendedCvp);
      const expectedVesting = entitledVesting.add(pendedVesting);

      await time.advanceBlockTo(`${1 * currentBlock - 1}`);
      const tx = await this.vestingMath.__computeCvpVesting(user, accCvpPerLpt);
      const res = tx.receipt.logs[0].args;

      assert.equal(res.lastUpdateBlock.toString(), currentBlock);
      // new CVPs entitled
      assert.equal(res.newlyEntitled.toString(), expectedEntitled.toString());
      // a part of "new" CVPs and a part of "old" CVPs are vested
      assert.equal(res.newlyVested.toString(), expectedVesting.toString());
      // only newly entitled CVPs remain pended with the vesting block in vesting period from now
      assert.equal(
        res.pendedCvp.toString(),
        toBN(user.pendedCvp).add(expectedEntitled).sub(expectedVesting).toString(),
      );
      assert.equal(res.vestingBlock.toString(), `${1 * currentBlock + 1 * vestPeriod}`);
    });
  });
});
