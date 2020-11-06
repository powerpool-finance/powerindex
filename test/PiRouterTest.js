const { expectRevert, ether } = require('@openzeppelin/test-helpers');
const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const PiBPoolController = artifacts.require('PiBPoolController');
const MockErc20Migrator = artifacts.require('MockErc20Migrator');
const PiRouter = artifacts.require('PiRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PiSimpleRouter = artifacts.require('PiSimpleRouter');
const PoolRestrictions = artifacts.require('PoolRestrictions');

MockERC20.numberFormat = 'String';
MockErc20Migrator.numberFormat = 'String';
BPool.numberFormat = 'String';
PiBPoolController.numberFormat = 'String';
PiRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const {web3} = BFactory;

describe('PiBPoolController', () => {
    let minter, bob, carol, alice, feeManager, feeReceiver, communityWallet, newCommunityWallet;

    before(async function() {
        [minter, bob, carol, alice, feeManager, feeReceiver, communityWallet, newCommunityWallet] = await web3.eth.getAccounts();
    });

    it('should allow swapping a token with a new version', async () => {
        const token = await MockERC20.new('My Token 3', 'MT3', ether('1000000'));
        const router = await PiSimpleRouter.new();
        const wrapper = await WrappedPiErc20.new(token.address, router.address, 'WToken', 'WTKN');
        const poolRestrictions = await PoolRestrictions.new();
        const router2 = await PiRouter.new(poolRestrictions.address);

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
