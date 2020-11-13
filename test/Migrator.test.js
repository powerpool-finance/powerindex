const { expectRevert } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const CvpToken = artifacts.require('MockCvp');
const LPMining = artifacts.require('LPMining');
const MockERC20 = artifacts.require('MockERC20');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const Migrator = artifacts.require('Migrator');
const Reservoir = artifacts.require('Reservoir');
const { web3 } = Reservoir;

describe('Migrator', () => {
  let alice, bob, minter;
  before(async function () {
    [alice, bob, minter] = await web3.eth.getAccounts();
  });

  beforeEach(async () => {
    this.factory1 = await UniswapV2Factory.new(alice, { from: alice });
    this.factory2 = await UniswapV2Factory.new(alice, { from: alice });
    this.cvp = await CvpToken.new({ from: alice });
    this.weth = await MockERC20.new('WETH', 'WETH', '100000000', { from: minter });
    this.token = await MockERC20.new('TOKEN', 'TOKEN', '100000000', { from: minter });
    this.lp1 = await UniswapV2Pair.at(
      (await this.factory1.createPair(this.weth.address, this.token.address)).logs[0].args.pair,
    );
    this.lp2 = await UniswapV2Pair.at(
      (await this.factory2.createPair(this.weth.address, this.token.address)).logs[0].args.pair,
    );

    this.reservoir = await Reservoir.new({ from: alice });
    this.lpMining = await LPMining.new(this.cvp.address, this.reservoir.address, '1000', '0', { from: alice });
    this.migrator = await Migrator.new(this.lpMining.address, this.factory1.address, this.factory2.address, '0');

    const supply = await this.cvp.totalSupply();
    await this.cvp.transfer(this.reservoir.address, supply, { from: alice });
    await this.reservoir.setApprove(this.cvp.address, this.lpMining.address, supply, { from: alice });

    await this.lpMining.add('100', this.lp1.address, '1', true, { from: alice });
  });

  it('should do the migration successfully', async () => {
    await this.token.transfer(this.lp1.address, '10000000', { from: minter });
    await this.weth.transfer(this.lp1.address, '500000', { from: minter });
    await this.lp1.mint(minter);
    assert.equal((await this.lp1.balanceOf(minter)).valueOf(), '2235067');
    // Add some fake revenue
    await this.token.transfer(this.lp1.address, '100000', { from: minter });
    await this.weth.transfer(this.lp1.address, '5000', { from: minter });
    await this.lp1.sync();
    await this.lp1.approve(this.lpMining.address, '100000000000', { from: minter });
    await this.lpMining.deposit('0', '2000000', { from: minter });
    assert.equal((await this.lp1.balanceOf(this.lpMining.address)).valueOf(), '2000000');
    await expectRevert(this.lpMining.migrate(0), 'migrate: no migrator');
    await this.lpMining.setMigrator(this.migrator.address, { from: alice });
    await expectRevert(this.lpMining.migrate(0), 'migrate: bad');
    await this.factory2.setMigrator(this.migrator.address, { from: alice });
    assert.equal(await this.lpMining.isLpTokenAdded(this.lp1.address), true);
    await this.lpMining.migrate(0);
    assert.equal(await this.lpMining.isLpTokenAdded(this.lp1.address), false);
    assert.equal(await this.lpMining.isLpTokenAdded(this.lp2.address), true);
    assert.equal((await this.lp1.balanceOf(this.lpMining.address)).valueOf(), '0');
    assert.equal((await this.lp2.balanceOf(this.lpMining.address)).valueOf(), '2000000');
    await this.lpMining.withdraw('0', '2000000', { from: minter });
    await this.lp2.transfer(this.lp2.address, '2000000', { from: minter });
    await this.lp2.burn(bob);
    assert.equal((await this.token.balanceOf(bob)).valueOf(), '9033718');
    assert.equal((await this.weth.balanceOf(bob)).valueOf(), '451685');
  });

  it('should allow first minting from public only after migrator is gone', async () => {
    await this.factory2.setMigrator(this.migrator.address, { from: alice });
    this.tokenx = await MockERC20.new('TOKENX', 'TOKENX', '100000000', { from: minter });
    this.lpx = await UniswapV2Pair.at(
      (await this.factory2.createPair(this.weth.address, this.tokenx.address)).logs[0].args.pair,
    );
    await this.weth.transfer(this.lpx.address, '10000000', { from: minter });
    await this.tokenx.transfer(this.lpx.address, '500000', { from: minter });
    await expectRevert(this.lpx.mint(minter), 'Must not have migrator');
    await this.factory2.setMigrator('0x0000000000000000000000000000000000000000', { from: alice });
    await this.lpx.mint(minter);
  });

  it('should reject migration for not the Uniswap poolType', async () => {
    this.token2 = await MockERC20.new('TOKEN2', 'TOKEN2', '100000000', { from: minter });
    this.lp3 = await UniswapV2Pair.at(
      (await this.factory1.createPair(this.weth.address, this.token2.address)).logs[0].args.pair,
    );
    await this.lpMining.add('100', this.lp3.address, '2', true, { from: alice });

    await this.token2.transfer(this.lp3.address, '10000000', { from: minter });
    await this.weth.transfer(this.lp3.address, '500000', { from: minter });
    await this.lp3.mint(minter);
    assert.equal((await this.lp3.balanceOf(minter)).valueOf(), '2235067');
    // Add some fake revenue
    await this.token2.transfer(this.lp3.address, '100000', { from: minter });
    await this.weth.transfer(this.lp3.address, '5000', { from: minter });
    await this.lp3.sync();
    await this.lp3.approve(this.lpMining.address, '100000000000', { from: minter });
    await this.lpMining.deposit('1', '2000000', { from: minter });
    assert.equal((await this.lp3.balanceOf(this.lpMining.address)).valueOf(), '2000000');
    await this.lpMining.setMigrator(this.migrator.address, { from: alice });
    await this.factory2.setMigrator(this.migrator.address, { from: alice });
    assert.equal(await this.lpMining.isLpTokenAdded(this.lp3.address), true);
    await expectRevert(this.lpMining.migrate('1'), 'Only Uniswap poolType supported');
  });
});
