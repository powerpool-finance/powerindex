const { expectRevert, time, ether } = require('@openzeppelin/test-helpers');
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');

const {web3} = BFactory;
const {toBN} = web3.utils;

contract('Balancer', ([alice, bob, carol, minter]) => {
    beforeEach(async () => {
        this.bFactory = await BFactory.new({ from: minter });
        this.bActions = await BActions.new({ from: minter });

        this.token1 = await MockERC20.new('My Token 1', 'MT1', ether('1000000'));
        this.token2 = await MockERC20.new('My Token 2', 'MT2', ether('1000000'));
    });

    it('should set name and symbol for new pool', async () => {
        const name = 'My Pool';
        const symbol = 'MP';
        const tokens = [this.token1.address, this.token2.address];
        const balances = [ether('10'), ether('20')];
        const weights = [ether('25'), ether('25')];
        const swapFee = ether('0.05');

        await this.token1.approve(this.bActions.address, balances[0]);
        await this.token2.approve(this.bActions.address, balances[1]);

        const res = await this.bActions.create(
            this.bFactory.address,
            'My Pool',
            'MP',
            tokens,
            balances,
            weights,
            swapFee,
            true
        );

        const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
        const resultPool = await BPool.at(logNewPool.args.pool);
        assert.equal(await resultPool.name(), name);
        assert.equal(await resultPool.symbol(), symbol);
        assert.sameMembers(await resultPool.getCurrentTokens(), tokens);
        assert.equal((await resultPool.getDenormalizedWeight(tokens[0])).toString(), weights[0].toString());
        assert.equal((await resultPool.getDenormalizedWeight(tokens[1])).toString(), weights[1].toString());
        assert.equal((await resultPool.getSwapFee()).toString(), swapFee.toString());
    });
});
