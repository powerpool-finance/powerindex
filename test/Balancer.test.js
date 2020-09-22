const { expectRevert, time, ether } = require('@openzeppelin/test-helpers');
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const WETH = artifacts.require('WETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');

const {web3} = BFactory;
const {toBN} = web3.utils;

function mulScalarBN(bn1, bn2) {
    return toBN(bn1.toString(10)).mul(toBN(bn2.toString(10))).div(toBN(ether('1').toString(10))).toString(10);
}
function subBN(bn1, bn2) {
    return toBN(bn1.toString(10)).sub(toBN(bn2.toString(10))).toString(10);
}
function addBN(bn1, bn2) {
    return toBN(bn1.toString(10)).add(toBN(bn2.toString(10))).toString(10);
}

contract('Balancer', ([minter, bob, carol, alice, communityWallet, labsWallet]) => {
    const name = 'My Pool';
    const symbol = 'MP';
    const balances = [ether('10'), ether('20')];
    const weights = [ether('25'), ether('25')];
    const swapFee = ether('0.01');
    const communityFee = ether('0.05');

    let tokens;

    beforeEach(async () => {
        this.weth = await WETH.new();

        this.bFactory = await BFactory.new({ from: minter });
        this.bActions = await BActions.new({ from: minter });
        this.bExchange = await ExchangeProxy.new(this.weth.address, { from: minter });

        this.token1 = await MockERC20.new('My Token 1', 'MT1', ether('1000000'));
        this.token2 = await MockERC20.new('My Token 2', 'MT2', ether('1000000'));
        tokens = [this.token1.address, this.token2.address];
    });

    it('should set name and symbol for new pool', async () => {
        await this.token1.approve(this.bActions.address, balances[0]);
        await this.token2.approve(this.bActions.address, balances[1]);

        const res = await this.bActions.create(
            this.bFactory.address,
            name,
            symbol,
            tokens,
            balances,
            weights,
            [swapFee, communityFee],
            communityWallet,
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

    it('community fee should work properly', async () => {
        await this.token1.approve(this.bActions.address, balances[0]);
        await this.token2.approve(this.bActions.address, balances[1]);

        const res = await this.bActions.create(
            this.bFactory.address,
            name,
            symbol,
            tokens,
            balances,
            weights,
            [swapFee, communityFee],
            communityWallet,
            true
        );

        const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
        const resultPool = await BPool.at(logNewPool.args.pool);

        const amountToSwap = ether('0.1').toString(10);
        await this.token1.transfer(alice, amountToSwap);
        await this.token1.approve(this.bExchange.address, amountToSwap, {from: alice});

        const amountCommunityFee = mulScalarBN(amountToSwap, communityFee);
        const amountAfterCommunityFee = subBN(amountToSwap, amountCommunityFee);

        const tokensOut = (await resultPool.calcOutGivenIn(
            balances[0],
            weights[0],
            balances[1],
            weights[1],
            amountAfterCommunityFee,
            swapFee
        )).toString(10);

        const price = (await resultPool.calcSpotPrice(
            addBN(balances[0], amountToSwap),
            weights[0],
            subBN(balances[1], tokensOut),
            weights[1],
            swapFee
        )).toString(10);

        assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
        const token1PoolBalanceBefore = (await this.token1.balanceOf(resultPool.address)).toString();

        await this.bExchange.multihopBatchSwapExactIn(
            [[{
                pool: resultPool.address,
                tokenIn: this.token1.address,
                tokenOut: this.token2.address,
                swapAmount: amountToSwap,
                limitReturnAmount: tokensOut,
                maxPrice: mulScalarBN(price, ether('1.05'))
            }]],
            this.token1.address,
            this.token2.address,
            amountToSwap,
            tokensOut,
            {from: alice}
        );

        assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
        assert.equal((await this.token1.balanceOf(communityWallet)).toString(), amountCommunityFee.toString());
        assert.equal(
            (await this.token1.balanceOf(resultPool.address)).toString(),
            addBN(token1PoolBalanceBefore, amountAfterCommunityFee)
        );
        assert.equal((await this.token2.balanceOf(alice)).toString(), tokensOut.toString());
    });
});
