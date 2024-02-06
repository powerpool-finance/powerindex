// const { expectRevert, time } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const { ethers} = require('hardhat');
const CvpToken = artifacts.require('MockCvp');
const LPMining = artifacts.require('LPMining');
const PoolsLens = artifacts.require('PoolsLens');
const VestedLpMiningLens = artifacts.require('VestedLpMiningLens');
const MockERC20 = artifacts.require('MockERC20');
const Reservoir = artifacts.require('Reservoir');
const zeroAddress = '0x0000000000000000000000000000000000000000';

const { web3 } = Reservoir;
// const { toBN } = web3.utils;

VestedLpMiningLens.numberFormat = 'String';

describe.only('PoolsLens', async () => {
  try {
    it('Zero pool is doing fine', async () => {
      this.poolsLens = await PoolsLens.new(
          '0xF09232320eBEAC33fae61b24bB8D7CA192E58507',
          '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
          '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      );
      const zeroPool = await this.poolsLens.getPoolData(0);
      console.log('zero pool info is: ', zeroPool);
    });
  } catch (e) {
    console.error(e)
  }
});
