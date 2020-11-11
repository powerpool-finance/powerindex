const { expectRevert, ether } = require('@openzeppelin/test-helpers');
const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const MockErc20Migrator = artifacts.require('MockErc20Migrator');
const PowerIndexRouter = artifacts.require('PowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PowerIndexSimpleRouter = artifacts.require('PowerIndexSimpleRouter');
const PoolRestrictions = artifacts.require('PoolRestrictions');

MockERC20.numberFormat = 'String';
MockErc20Migrator.numberFormat = 'String';
BPool.numberFormat = 'String';
PowerIndexPoolController.numberFormat = 'String';
PowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const {web3} = BFactory;

describe('PowerIndex Router Test', () => {
    let minter, bob, carol, alice, feeManager, feeReceiver, communityWallet, newCommunityWallet;

    before(async function() {
        [minter, bob, carol, alice, feeManager, feeReceiver, communityWallet, newCommunityWallet] = await web3.eth.getAccounts();
    });

    it('should allow swapping a token with a new version', async () => {
        const token = await MockERC20.new('My Token 3', 'MT3', ether('1000000'));
        const router = await PowerIndexSimpleRouter.new();
        const wrapper = await WrappedPiErc20.new(token.address, router.address, 'WToken', 'WTKN');
        const poolRestrictions = await PoolRestrictions.new();
        const router2 = await PowerIndexRouter.new(poolRestrictions.address);

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
