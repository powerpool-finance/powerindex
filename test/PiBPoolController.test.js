const { expectRevert, time, ether, expectEvent } = require('@openzeppelin/test-helpers');
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const MockCvp = artifacts.require('MockCvp');
const WETH = artifacts.require('MockWETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const BPoolWrapper = artifacts.require('BPoolWrapper');
const PiBPoolController = artifacts.require('PiBPoolController');
const MockErc20Migrator = artifacts.require('MockErc20Migrator');
const PiRouter = artifacts.require('PiRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');

MockERC20.numberFormat = 'String';
MockErc20Migrator.numberFormat = 'String';
BPool.numberFormat = 'String';
PiBPoolController.numberFormat = 'String';
PiRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const {web3} = BFactory;
const {toBN} = web3.utils;

function mulScalarBN(bn1, bn2) {
    return toBN(bn1.toString(10)).mul(toBN(bn2.toString(10))).div(toBN(ether('1').toString(10))).toString(10);
}
function divScalarBN(bn1, bn2) {
    return toBN(bn1.toString(10)).mul(toBN(ether('1').toString(10))).div(toBN(bn2.toString(10))).toString(10);
}
function subBN(bn1, bn2) {
    return toBN(bn1.toString(10)).sub(toBN(bn2.toString(10))).toString(10);
}
function addBN(bn1, bn2) {
    return toBN(bn1.toString(10)).add(toBN(bn2.toString(10))).toString(10);
}

function assertEqualWithAccuracy(bn1, bn2, message, accuracyWei = '30') {
    bn1 = toBN(bn1.toString(10));
    bn2 = toBN(bn2.toString(10));
    const bn1GreaterThenBn2 = bn1.gt(bn2);
    let diff = bn1GreaterThenBn2 ? bn1.sub(bn2) : bn2.sub(bn1);
    assert.equal(diff.lte(toBN(accuracyWei)), true, message);
}

describe('PiBPoolController', () => {
    const name = 'My Pool';
    const symbol = 'MP';
    const balances = [ether('10'), ether('20')];
    const weights = [ether('25'), ether('25')];
    const swapFee = ether('0.01');
    const communitySwapFee = ether('0.05');
    const communityJoinFee = ether('0.04');
    const communityExitFee = ether('0.07');

    let tokens;
    let pool;
    let poolWrapper;
    let controller;

    let minter, bob, carol, alice, feeManager, feeReceiver, communityWallet, newCommunityWallet;
    let amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut;

    before(async function() {
        [minter, bob, carol, alice, feeManager, feeReceiver, communityWallet, newCommunityWallet] = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        this.weth = await WETH.new();

        this.bFactory = await BFactory.new({ from: minter });
        this.bActions = await BActions.new({ from: minter });
        this.bExchange = await ExchangeProxy.new(this.weth.address, { from: minter });

        this.token1 = await MockCvp.new();
        this.token2 = await MockERC20.new('My Token 2', 'MT2', ether('1000000'));
        tokens = [this.token1.address, this.token2.address];

        await this.token1.approve(this.bActions.address, balances[0]);
        await this.token2.approve(this.bActions.address, balances[1]);

        const res = await this.bActions.create(
            this.bFactory.address,
            name,
            symbol,
            tokens,
            balances,
            weights,
            [swapFee, communitySwapFee, communityJoinFee, communityExitFee],
            communityWallet,
            true
        );

        const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
        pool = await BPool.at(logNewPool.args.pool);

        poolWrapper = await BPoolWrapper.new(pool.address);
        controller = await PiBPoolController.new(pool.address);

        await pool.setWrapper(poolWrapper.address, true);
        await pool.setController(controller.address);

        this.getTokensToJoinPoolAndApprove = async (amountToMint) => {
            const poolTotalSupply = (await pool.totalSupply()).toString(10);
            const ratio = divScalarBN(amountToMint, poolTotalSupply);
            const token1Amount = mulScalarBN(ratio, (await pool.getBalance(this.token1.address)).toString(10));
            const token2Amount = mulScalarBN(ratio, (await pool.getBalance(this.token2.address)).toString(10));
            await this.token1.approve(poolWrapper.address, token1Amount);
            await this.token2.approve(poolWrapper.address, token2Amount);
            return [token1Amount, token2Amount];
        }

        amountToSwap = ether('0.1').toString(10);
        await this.token1.transfer(alice, amountToSwap);
        await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
        await this.token1.approve(poolWrapper.address, amountToSwap, {from: alice});
        await this.token2.approve(poolWrapper.address, mulScalarBN(amountToSwap, ether('2')), {from: alice});
        await this.token1.approve(this.bExchange.address, amountToSwap, {from: alice});
        await this.token2.approve(this.bExchange.address, mulScalarBN(amountToSwap, ether('2')), {from: alice});

        amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
        amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

        expectedSwapOut = (await pool.calcOutGivenIn(
            balances[0],
            weights[0],
            balances[1],
            weights[1],
            amountAfterCommunitySwapFee,
            swapFee
        )).toString(10);
    });

    it('should allow swapping a token with a new version', async () => {
        this.token3 = await MockERC20.new('My Token 3', 'MT3', ether('1000000'));
        this.migrator = await MockErc20Migrator.new(this.token2.address, this.token3.address, alice);
        const amount = await pool.getBalance(this.token2.address);
        await this.token3.transfer(this.migrator.address, ether('1000000'));
        const migratorData = this.migrator.contract.methods.migrate(controller.address, amount).encodeABI();

        const res = await controller.replacePoolTokenWithNewVersion(
            this.token2.address,
            this.token3.address,
            this.migrator.address,
            migratorData
        );
        expectEvent(res, 'ReplacePoolTokenWithNewVersion', {
            oldToken: this.token2.address,
            newToken: this.token3.address,
            migrator: this.migrator.address,
            balance: ether('20'),
            denormalizedWeight: ether('25'),
        });

        const price = (await pool.calcSpotPrice(
            addBN(balances[0], amountToSwap),
            weights[0],
            subBN(balances[1], expectedSwapOut),
            weights[1],
            swapFee
        )).toString(10);

        assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
        const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
        const token3AliceBalanceBefore = (await this.token3.balanceOf(alice)).toString();

        await this.token1.approve(poolWrapper.address, amountToSwap, {from: alice});
        // TODO: A wrong error message due probably the Buidler EVM bug
        await expectRevert.unspecified(poolWrapper.swapExactAmountIn(
            this.token1.address,
            amountToSwap,
            this.token2.address,
            expectedSwapOut,
            mulScalarBN(price, ether('1.05')),
            {from: alice}
        ), 'NOT_BOUND');

        await poolWrapper.swapExactAmountIn(
            this.token1.address,
            amountToSwap,
            this.token3.address,
            expectedSwapOut,
            mulScalarBN(price, ether('1.05')),
            {from: alice}
        );

        assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
        assert.equal(
            (await this.token1.balanceOf(pool.address)).toString(),
            addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee)
        );

        assert.equal(
            (await this.token3.balanceOf(alice)).toString(),
            addBN(token3AliceBalanceBefore, expectedSwapOut).toString()
        );
    });

    it('should allow swapping a token with a new wrapped version', async () => {
        const poolRestrictions = await PoolRestrictions.new();
        const router = await PiRouter.new(poolRestrictions.address);

        let res = await controller.replacePoolTokenWithWrapped(
            this.token2.address,
            router.address,
            'WrappedTKN2',
            'WTKN2'
        );
        const wToken2 = await WrappedPiErc20.at(res.logs[0].args.wrappedToken);
        expectEvent(res, 'ReplacePoolTokenWithWrapped', {
            existingToken: this.token2.address,
            wrappedToken: wToken2.address,
            router: router.address,
            balance: ether('20'),
            denormalizedWeight: ether('25'),
            name: 'WrappedTKN2',
            symbol: 'WTKN2',
        });

        const price = (await pool.calcSpotPrice(
            addBN(balances[0], amountToSwap),
            weights[0],
            subBN(balances[1], expectedSwapOut),
            weights[1],
            swapFee
        )).toString(10);

        assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
        const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
        const token2AliceBalanceBefore = (await wToken2.balanceOf(alice)).toString();

        await this.token1.approve(poolWrapper.address, amountToSwap, {from: alice});
        // TODO: A wrong error message due probably the Buidler EVM bug
        await expectRevert.unspecified(poolWrapper.swapExactAmountIn(
            this.token1.address,
            amountToSwap,
            this.token2.address,
            expectedSwapOut,
            mulScalarBN(price, ether('1.05')),
            {from: alice}
        ));

        await poolWrapper.swapExactAmountIn(
            this.token1.address,
            amountToSwap,
            wToken2.address,
            expectedSwapOut,
            mulScalarBN(price, ether('1.05')),
            {from: alice}
        );

        assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
        assert.equal(
            (await this.token1.balanceOf(pool.address)).toString(),
            addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee)
        );

        assert.equal(
            (await wToken2.balanceOf(alice)).toString(),
            addBN(token2AliceBalanceBefore, expectedSwapOut).toString()
        );
    })

    it('should allow making a wrapped token join and exit', async () => {
        const poolRestrictions = await PoolRestrictions.new();
        const router = await PiRouter.new(poolRestrictions.address);

        let res = await controller.replacePoolTokenWithWrapped(
            this.token2.address,
            router.address,
            'WrappedTKN2',
            'WTKN2'
        );
        const wToken2 = await WrappedPiErc20.at(res.logs[0].args.wrappedToken);
        assert.equal(await wToken2.balanceOf(pool.address), ether('20'));

        await this.token2.approve(wToken2.address, ether('0.2'), { from: alice });
        await wToken2.deposit(ether('0.2'), { from: alice });

        const poolOutAmount = divScalarBN(
            mulScalarBN(amountToSwap, await pool.totalSupply()),
            await pool.getBalance(this.token1.address)
        );
        let ratio = divScalarBN(poolOutAmount, await pool.totalSupply());
        const token1InAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
        const token2InAmount = mulScalarBN(ratio, await pool.getBalance(wToken2.address));

        const poolOutAmountFee = mulScalarBN(poolOutAmount, communityJoinFee);
        const poolOutAmountAfterFee = subBN(poolOutAmount, poolOutAmountFee);

        await expectRevert(pool.joinPool(
            poolOutAmount,
            [token1InAmount, token2InAmount],
            {from: alice}
        ), 'ONLY_WRAPPER');

        await wToken2.approve(poolWrapper.address, ether(token2InAmount), { from: alice });
        await poolWrapper.joinPool(
            poolOutAmount,
            [token1InAmount, token2InAmount],
            {from: alice}
        );

        assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
        assert.equal((await wToken2.balanceOf(alice)).toString(), '0');
        assert.equal(await this.token1.balanceOf(pool.address), addBN(token1InAmount, balances[0]));
        assert.equal(await wToken2.balanceOf(pool.address), addBN(token2InAmount, balances[1]));
        assert.equal((await pool.balanceOf(alice)).toString(), poolOutAmountAfterFee.toString());

        const poolInAmountFee = mulScalarBN(poolOutAmountAfterFee, communityExitFee);
        const poolInAmountAfterFee = subBN(poolOutAmountAfterFee, poolInAmountFee);

        ratio = divScalarBN(poolInAmountAfterFee, await pool.totalSupply());
        const token1OutAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
        const token2OutAmount = mulScalarBN(ratio, await pool.getBalance(wToken2.address));

        await pool.approve(poolWrapper.address, poolOutAmountAfterFee, {from: alice});

        await expectRevert(pool.exitPool(
            poolOutAmountAfterFee,
            [token1OutAmount, token2OutAmount],
            {from: alice}
        ), 'ONLY_WRAPPER');

        await poolWrapper.exitPool(
            poolOutAmountAfterFee,
            [token1OutAmount, token2OutAmount],
            {from: alice}
        );

        assertEqualWithAccuracy((await pool.balanceOf(alice)).toString(), '0');
        assertEqualWithAccuracy((await this.token1.balanceOf(alice)).toString(), token1OutAmount);
        assertEqualWithAccuracy((await wToken2.balanceOf(alice)).toString(), token2OutAmount);
        assertEqualWithAccuracy(await this.token1.balanceOf(pool.address), subBN(addBN(token1InAmount, balances[0]), token1OutAmount));
        assertEqualWithAccuracy(await wToken2.balanceOf(pool.address), subBN(addBN(token2InAmount, balances[1]), token2OutAmount));
    });
});
