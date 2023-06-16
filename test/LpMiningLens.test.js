// const { expectRevert, time } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const CvpToken = artifacts.require('MockCvp');
const LPMining = artifacts.require('LPMining');
const VestedLpMining = artifacts.require('VestedLPMining');
const VestedLpMiningLens = artifacts.require('VestedLpMiningLens');
const MockERC20 = artifacts.require('MockERC20');
const Reservoir = artifacts.require('Reservoir');
const zeroAddress = '0x0000000000000000000000000000000000000000';

const { web3 } = Reservoir;
// const { toBN } = web3.utils;

VestedLpMiningLens.numberFormat = 'String';

describe.only('LPMiningLens', () => {
  let alice, bob, carol, minter;
  before(async function () {
    [alice, bob, carol, minter] = await web3.eth.getAccounts();
  });
  let referenceBlock;
  beforeEach(async () => {
    this.cvp = await CvpToken.new({ from: minter });
    referenceBlock = (await web3.eth.getBlockNumber());
    this.shiftBlock = blockNum => `${1 * referenceBlock + 1 * blockNum}`;
  });

  context('With ERC/LP token added to the field', () => {
    beforeEach(async () => {
      this.lp = await MockERC20.new('LPToken', 'LP', '18', '10000000000', { from: minter });
      await this.lp.transfer(alice, '1000', { from: minter });
      await this.lp.transfer(bob, '1000', { from: minter });
      await this.lp.transfer(carol, '1000', { from: minter });
      this.lp2 = await MockERC20.new('LPToken2', 'LP2', '18', '10000000000', { from: minter });
      await this.lp2.transfer(alice, '1000', { from: minter });
      await this.lp2.transfer(bob, '1000', { from: minter });
      await this.lp2.transfer(carol, '1000', { from: minter });
    });

    it.only('pool can be created', async () => {
      this.lpMining = await VestedLpMining.new({ from: minter });
      await this.lpMining.initialize(
        this.cvp.address,
        zeroAddress,
        '100', // _cvpPerBlock
        this.shiftBlock('50'), // _startBlock
        '10', // _cvpVestingPeriodInBlocks
        { from: minter }
      );
      this.lpMiningLens = await VestedLpMiningLens.new(this.lpMining.address);

      await this.lpMining.setVotingEnabled(true, {from: bob});
      await this.lpMining.add('100', this.lp.address, '1', true, '0', '0', '0', '0', { from: minter });
      await this.lp.approve(this.lpMining.address, '1000', { from: bob });
      await this.lpMining.deposit(0, '100', 0, { from: bob });
      const pools = await this.lpMiningLens.getPools();
      assert.equal((await this.lp.balanceOf(bob)).valueOf(), '900');
      assert.equal(pools.length, 1);
      assert.equal(pools[0].allocPoint, '100');
      console.log(pools[0]);
    });
  });
});
