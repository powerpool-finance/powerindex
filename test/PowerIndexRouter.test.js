const { expectRevert, ether } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PowerIndexSimpleRouter = artifacts.require('PowerIndexSimpleRouter');
const PoolRestrictions = artifacts.require('PoolRestrictions');

MockERC20.numberFormat = 'String';
PowerIndexSimpleRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = MockERC20;

describe('PowerIndex Router Test', () => {
  let minter, bob, alice;

  before(async function () {
    [minter, bob, alice] = await web3.eth.getAccounts();
  });

  it('should allow swapping a token with a new version', async () => {
    const token = await MockERC20.new('My Token 3', 'MT3', '18', ether('1000000'));
    const poolRestrictions = await PoolRestrictions.new();
    const router = await PowerIndexSimpleRouter.new(poolRestrictions.address);
    const wrapper = await WrappedPiErc20.new(token.address, router.address, 'WToken', 'WTKN');
    const router2 = await PowerIndexSimpleRouter.new(poolRestrictions.address);

    assert.equal(await router.owner(), minter);

    await token.transfer(alice, ether('100'));
    await token.approve(wrapper.address, ether('100'), { from: alice });
    await wrapper.deposit(ether('100'), { from: alice });

    assert.equal(await wrapper.totalSupply(), ether('100'));
    assert.equal(await wrapper.balanceOf(alice), ether('100'));

    await expectRevert.unspecified(wrapper.changeRouter(bob));
    await router.migrateWrappedTokensToNewRouter([wrapper.address], router2.address);

    assert.equal(await wrapper.router(), router2.address);

    await wrapper.approve(wrapper.address, ether('100'), { from: alice });
    await wrapper.withdraw(ether('100'), { from: alice });

    assert.equal(await wrapper.totalSupply(), ether('0'));
    assert.equal(await wrapper.balanceOf(alice), ether('0'));
    assert.equal(await token.balanceOf(alice), ether('100'));
  });
});
