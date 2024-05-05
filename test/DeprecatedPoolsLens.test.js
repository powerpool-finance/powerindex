// const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { ethers} = require('hardhat');
const PoolsLens = artifacts.require('DeprecatedPoolsLens');
const zeroAddress = '0x0000000000000000000000000000000000000000';

describe.only('DeprecatedPoolsLens', async () => {
  try {
    it('chore test pass', async () => {
      this.poolsLens = await PoolsLens.new(
        '0xF09232320eBEAC33fae61b24bB8D7CA192E58507',
        '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1',
      );
      // const result = await this.poolsLens.getPoolData(ethers.constants.AddressZero);
      // const result = await this.poolsLens.getEarnList('0x8b19f6F51501dA80FCEFb578427907f223005F7A');

      const result = await this.poolsLens.getSecondaryLiquidityRemoveInfo('0x8b19f6F51501dA80FCEFb578427907f223005F7A', 7); // balancer
      // const result = await this.poolsLens.getSecondaryLiquidityRemoveInfo('0x8b19f6F51501dA80FCEFb578427907f223005F7A', 11); // sushi

      // const result = await this.poolsLens.getFarmingDetail('0xCce0bca1365a02e5770390165E64d1F59238D92e', 7);
      // const result = await this.poolsLens.getMiningManager(ethers.constants.AddressZero);
      console.log('result console: ', result);
    });
  } catch (e) {
    console.error(e)
  }
});
