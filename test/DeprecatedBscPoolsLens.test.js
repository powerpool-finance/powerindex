// const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { ethers} = require('hardhat');
const PoolsLens = artifacts.require('DeprecatedBscPoolsLens');
const zeroAddress = '0x0000000000000000000000000000000000000000';

describe.only('DeprecatedBscPoolsLens', async () => {
  try {
    it('chore test pass', async () => {
      this.poolsLens = await PoolsLens.new(
        '0x40E46dE174dfB776BB89E04dF1C47d8a66855EB3'
      );
      // const result = await this.poolsLens.getEarnList('0x8b19f6F51501dA80FCEFb578427907f223005F7A');
      const result = await this.poolsLens.removeLiquidityInfo('0x8b19f6F51501dA80FCEFb578427907f223005F7A', 0);
      console.log('main: ', result);
    });
  } catch (e) {
    console.error(e)
  }
});
