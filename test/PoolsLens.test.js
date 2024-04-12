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
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1',
      );

      // ----------------- make sure weth path is exist
      // const wethPath = await this.poolsLens.getAmountsOut('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '0xdAC17F958D2ee523a2206206994597C13D831ec7');
      // console.log('weth path is: ', wethPath);
      //
      // ----------------- change stable and check weth path
      // await this.poolsLens.changeStable('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      // const wethPath = await this.poolsLens.getMappingPath('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      // console.log('weth path is: ', wethPath);
      //
      // ----------------- add cvp path and make sure it exists
      // await this.poolsLens.setTokenPath('0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1');
      // const wethPath = await this.poolsLens.getMappingPath('0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1');
      // console.log('cvp path is: ', wethPath);
      //
      // ----------------- Check zero pool is existing and valid
      // const zeroPool = await this.poolsLens.getPoolData(ethers.constants.AddressZero);
      const zeroPool = await this.poolsLens.getLiquidityManager('0x8b19f6F51501dA80FCEFb578427907f223005F7A');
      // const zeroPool = await this.poolsLens.getFarmingData(ethers.constants.AddressZero);
      console.log('zeroPool: ', zeroPool);
    });
  } catch (e) {
    console.error(e)
  }
});
