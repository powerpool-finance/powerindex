const { expectRevert, time, ether } = require('@openzeppelin/test-helpers');

const PiDynamicPoolBFactory = artifacts.require('PiDynamicPoolBFactory');
const PiDynamicBActions = artifacts.require('PiDynamicBActions');
const PiDynamicBPool = artifacts.require('PiDynamicBPool');
const MockERC20 = artifacts.require('MockERC20');
const MockVoting = artifacts.require('MockVoting');
const MockCvp = artifacts.require('MockCvp');
const WETH = artifacts.require('MockWETH');
const ExchangeProxy = artifacts.require('ExchangeProxy');
const PoolRestrictions = artifacts.require('PoolRestrictions');

const _ = require('lodash');
const pIteration = require('p-iteration');

PiDynamicBPool.numberFormat = 'String';

const {web3} = PiDynamicPoolBFactory;
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
function isBNHigherOrEqual(bn1, bn2) {
    return toBN(bn1.toString(10)).gte(toBN(bn2.toString(10)));
}
function isBNHigher(bn1, bn2) {
    return toBN(bn1.toString(10)).gt(toBN(bn2.toString(10)));
}

function assertEqualWithAccuracy(bn1, bn2, message, accuracyWei = '30') {
    bn1 = toBN(bn1.toString(10));
    bn2 = toBN(bn2.toString(10));
    const bn1GreaterThenBn2 = bn1.gt(bn2);
    let diff = bn1GreaterThenBn2 ? bn1.sub(bn2) : bn2.sub(bn1);
    assert.equal(diff.lte(toBN(accuracyWei)), true, message);
}

async function getTimestamp(shift = 0) {
    const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
    return currentTimestamp + shift;
}

describe('PiDynamicBPool', () => {
    const name = 'My Pool';
    const symbol = 'MP';
    const balances = [ether('10'), ether('20')].map(w => w.toString());
    const fromWeights = [ether('10'), ether('40')].map(w => w.toString());
    const targetWeights = [ether('15'), ether('10')].map(w => w.toString());
    let fromTimestamps;
    let targetTimestamps;
    const swapFee = ether('0.01');
    const communitySwapFee = ether('0.05');
    const communityJoinFee = ether('0.04');
    const communityExitFee = ether('0.07');

    let tokens;
    let pool;

    let minter, bob, carol, alice, feeManager, feeReceiver, communityWallet;
    before(async function() {
        [minter, bob, carol, alice, feeManager, feeReceiver, communityWallet] = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        this.weth = await WETH.new();

        this.bFactory = await PiDynamicPoolBFactory.new({ from: minter });
        this.bActions = await PiDynamicBActions.new({ from: minter });
        this.bExchange = await ExchangeProxy.new(this.weth.address, { from: minter });

        this.token1 = await MockCvp.new();
        this.token2 = await MockERC20.new('My Token 2', 'MT2', ether('1000000'));
        tokens = [this.token1.address, this.token2.address];

        fromTimestamps = [await getTimestamp(100), await getTimestamp(100)].map(w => w.toString());
        targetTimestamps = [await getTimestamp(1100), await getTimestamp(1100)].map(w => w.toString());

        await this.token1.approve(this.bActions.address, balances[0]);
        await this.token2.approve(this.bActions.address, balances[1]);

        const res = await this.bActions.create(
            this.bFactory.address,
            name,
            symbol,
            tokens.map((t, i) => ({
                token: t,
                balance: balances[i],
                fromDenorm: fromWeights[i],
                targetDenorm: targetWeights[i],
                fromTimestamp: fromTimestamps[i],
                targetTimestamp: targetTimestamps[i],
            })),
            [swapFee, communitySwapFee, communityJoinFee, communityExitFee],
            communityWallet,
            true
        );

        const logNewPool = PiDynamicPoolBFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
        pool = await PiDynamicBPool.at(logNewPool.args.pool);

        this.getTokensToJoinPoolAndApprove = async (_pool, amountToMint) => {
            const poolTotalSupply = (await _pool.totalSupply()).toString(10);
            const ratio = divScalarBN(amountToMint, poolTotalSupply);
            const token1Amount = mulScalarBN(ratio, (await _pool.getBalance(this.token1.address)).toString(10));
            const token2Amount = mulScalarBN(ratio, (await _pool.getBalance(this.token2.address)).toString(10));
            await this.token1.approve(this.bActions.address, token1Amount);
            await this.token2.approve(this.bActions.address, token2Amount);
            return [token1Amount, token2Amount];
        }
    });

    it('should set name and symbol for new pool', async () => {
        assert.equal(await pool.name(), name);
        assert.equal(await pool.symbol(), symbol);
        assert.sameMembers(await pool.getCurrentTokens(), tokens);
        assert.deepEqual(_.pick(await pool.getDynamicWeightSettings(tokens[0]), ['fromTimestamp', 'targetTimestamp', 'fromDenorm', 'targetDenorm']), {
            fromTimestamp: fromTimestamps[0],
            targetTimestamp: targetTimestamps[0],
            fromDenorm: fromWeights[0],
            targetDenorm: targetWeights[0]
        });
        assert.equal((await pool.getDenormalizedWeight(tokens[0])).toString(), fromWeights[0].toString());
        assert.equal((await pool.getDenormalizedWeight(tokens[1])).toString(), fromWeights[1].toString());
        assert.equal((await pool.getSwapFee()).toString(), swapFee.toString());
        const {
            communitySwapFee: _communitySwapFee,
            communityJoinFee: _communityJoinFee,
            communityExitFee: _communityExitFee,
            communityFeeReceiver: _communityFeeReceiver
        } = await pool.getCommunityFee();
        assert.equal(_communitySwapFee.toString(), communitySwapFee.toString());
        assert.equal(_communityJoinFee.toString(), communityJoinFee.toString());
        assert.equal(_communityExitFee.toString(), communityExitFee.toString());
        assert.equal(_communityFeeReceiver, communityWallet);
    });

    async function getDenormWeight(token, timestamp) {
        const dynamicWeight = await pool.getDynamicWeightSettings(token);
        if (dynamicWeight.fromTimestamp === '0' ||
            dynamicWeight.fromDenorm === dynamicWeight.targetDenorm ||
            isBNHigherOrEqual(dynamicWeight.fromTimestamp, timestamp)) {
            return dynamicWeight.fromDenorm;
        }
        if (isBNHigherOrEqual(timestamp, dynamicWeight.targetTimestamp)) {
            return dynamicWeight.targetDenorm;
        }
        const deltaTargetTime = subBN(dynamicWeight.targetTimestamp, dynamicWeight.fromTimestamp);
        const deltaCurrentTime = subBN(timestamp, dynamicWeight.fromTimestamp);
        let deltaWeight;
        if(isBNHigher(dynamicWeight.targetDenorm, dynamicWeight.fromDenorm)) {
            deltaWeight = subBN(dynamicWeight.targetDenorm, dynamicWeight.fromDenorm);
            const weightPerSecond = divScalarBN(deltaWeight, deltaTargetTime);
            return addBN(dynamicWeight.fromDenorm, mulScalarBN(deltaCurrentTime, weightPerSecond));
        } else {
            deltaWeight = subBN(dynamicWeight.fromDenorm, dynamicWeight.targetDenorm);
            const weightPerSecond = divScalarBN(deltaWeight, deltaTargetTime);
            return subBN(dynamicWeight.fromDenorm, mulScalarBN(deltaCurrentTime, weightPerSecond));
        }
    }

    describe('test swap after time spent', () => {
        let amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut;

        for (let sec = 10; sec < 1300; sec += 100) {
            if(sec > 210) {
                break;
            }
            it.only(`should correctly swap by multihopBatchSwapExactIn after ${sec} seconds pass`, async () => {
                amountToSwap = ether('1').toString(10);
                await this.token1.transfer(alice, amountToSwap);
                await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
                await this.token1.approve(this.bExchange.address, amountToSwap, {from: alice});
                await this.token1.approve(this.bActions.address, amountToSwap, {from: alice});
                await this.token2.approve(this.bActions.address, mulScalarBN(amountToSwap, ether('2')), {from: alice});

                amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
                amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

                console.log('sec', sec);
                time.increase(sec);

                const etherWeights = await pIteration.map(tokens, async (t) => {
                    return web3.utils.fromWei(await pool.getDenormalizedWeight(t), 'ether');
                })
                console.log('current weights', etherWeights.join(', '));

                expectedSwapOut = (await pool.calcOutGivenIn(
                    await pool.getBalance(tokens[0]),
                    await getDenormWeight(tokens[0], await getTimestamp(1)),
                    await pool.getBalance(tokens[1]),
                    await getDenormWeight(tokens[1], await getTimestamp(1)),
                    amountAfterCommunitySwapFee,
                    swapFee
                )).toString(10);
                console.log('expectedSwapOut', web3.utils.fromWei(expectedSwapOut, 'ether'));

                const price = (await pool.calcSpotPrice(
                    addBN(await pool.getBalance(tokens[0]), amountToSwap),
                    await getDenormWeight(tokens[0], await getTimestamp(1)),
                    subBN(await pool.getBalance(tokens[1]), expectedSwapOut),
                    await getDenormWeight(tokens[1], await getTimestamp(1)),
                    swapFee
                )).toString(10);

                assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
                const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
                const token2AliceBalanceBefore = (await this.token2.balanceOf(alice)).toString();

                await this.bExchange.multihopBatchSwapExactIn(
                    [[{
                        pool: pool.address,
                        tokenIn: this.token1.address,
                        tokenOut: this.token2.address,
                        swapAmount: amountToSwap,
                        limitReturnAmount: expectedSwapOut,
                        maxPrice: mulScalarBN(price, ether('1.05'))
                    }]],
                    this.token1.address,
                    this.token2.address,
                    amountToSwap,
                    expectedSwapOut,
                    {from: alice}
                );

                const expectedSwapOutAfter = (await pool.calcOutGivenIn(
                    await pool.getBalance(tokens[0]),
                    await getDenormWeight(tokens[0], await getTimestamp(1)),
                    await pool.getBalance(tokens[1]),
                    await getDenormWeight(tokens[1], await getTimestamp(1)),
                    amountAfterCommunitySwapFee,
                    swapFee
                )).toString(10);
                console.log('expectedSwapOut after', web3.utils.fromWei(expectedSwapOutAfter, 'ether'));

                assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
                assert.equal(
                    (await this.token1.balanceOf(communityWallet)).toString(),
                    amountCommunitySwapFee.toString()
                );
                assert.equal(
                    (await this.token1.balanceOf(pool.address)).toString(),
                    addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee)
                );
                assert.equal((await this.token2.balanceOf(alice)).toString(), addBN(token2AliceBalanceBefore, expectedSwapOut).toString());
            });
        }
    });

    describe('community fee', () => {
        let amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut;
        beforeEach(async () => {
            amountToSwap = ether('0.1').toString(10);
            await this.token1.transfer(alice, amountToSwap);
            await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
            await this.token1.approve(this.bExchange.address, amountToSwap, {from: alice});
            await this.token1.approve(this.bActions.address, amountToSwap, {from: alice});
            await this.token2.approve(this.bActions.address, mulScalarBN(amountToSwap, ether('2')), {from: alice});

            amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
            amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

            expectedSwapOut = (await pool.calcOutGivenIn(
                balances[0],
                fromWeights[0],
                balances[1],
                fromWeights[1],
                amountAfterCommunitySwapFee,
                swapFee
            )).toString(10);
        });

        it('community fee should work properly for multihopBatchSwapExactOut', async () => {
            const expectedOutWithFee = (await pool.calcOutGivenIn(
                balances[0],
                fromWeights[0],
                balances[1],
                fromWeights[1],
                amountToSwap,
                swapFee
            )).toString(10);
            const expectedOutFee = mulScalarBN(expectedOutWithFee, communitySwapFee);

            const price = (await pool.calcSpotPrice(
                addBN(balances[0], amountToSwap),
                fromWeights[0],
                subBN(balances[1], expectedOutWithFee),
                fromWeights[1],
                swapFee
            )).toString(10);

            assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
            const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
            const token2PoolBalanceBefore = (await this.token2.balanceOf(pool.address)).toString();
            const token2AliceBalanceBefore = (await this.token2.balanceOf(alice)).toString();

            await this.bExchange.multihopBatchSwapExactOut(
                [[{
                    pool: pool.address,
                    tokenIn: this.token1.address,
                    tokenOut: this.token2.address,
                    swapAmount: expectedOutWithFee,
                    limitReturnAmount: amountToSwap,
                    maxPrice: mulScalarBN(price, ether('1.05'))
                }]],
                this.token1.address,
                this.token2.address,
                amountToSwap,
                {from: alice}
            );

            assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
            assert.equal((await this.token2.balanceOf(communityWallet)).toString(), expectedOutFee);
            assert.equal(
                (await this.token1.balanceOf(pool.address)).toString(),
                addBN(token1PoolBalanceBefore, amountToSwap)
            );
            assert.equal(
                (await this.token2.balanceOf(pool.address)).toString(),
                subBN(token2PoolBalanceBefore, expectedOutWithFee)
            );
            assert.equal((await this.token2.balanceOf(alice)).toString(), addBN(token2AliceBalanceBefore, subBN(expectedOutWithFee, expectedOutFee)).toString());
        });

        it('community fee should work properly for joinswapExternAmountIn and exitswapPoolAmountIn', async () => {
            const amountCommunityJoinFee = mulScalarBN(amountToSwap, communityJoinFee);
            const amountAfterCommunityJoinFee = subBN(amountToSwap, amountCommunityJoinFee);

            expectedSwapOut = (await pool.calcOutGivenIn(
                balances[0],
                fromWeights[0],
                balances[1],
                fromWeights[1],
                amountAfterCommunityJoinFee,
                swapFee
            )).toString(10);

            const poolAmountOut = (await pool.calcPoolOutGivenSingleIn(
                await pool.getBalance(this.token1.address),
                await pool.getDenormalizedWeight(this.token1.address),
                await pool.totalSupply(),
                await pool.getTotalDenormalizedWeight(),
                amountAfterCommunityJoinFee,
                swapFee
            )).toString(10);

            let token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();

            await this.bActions.joinswapExternAmountIn(
                pool.address,
                this.token1.address,
                amountToSwap,
                poolAmountOut,
                {from: alice}
            );

            assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
            assert.equal((await this.token1.balanceOf(communityWallet)).toString(), amountCommunityJoinFee.toString());
            assert.equal(
                (await this.token1.balanceOf(pool.address)).toString(),
                addBN(token1PoolBalanceBefore, amountAfterCommunityJoinFee)
            );
            assert.equal((await pool.balanceOf(alice)).toString(), poolAmountOut.toString());

            const exitTokenAmountOut = (await pool.calcSingleOutGivenPoolIn(
                await pool.getBalance(this.token1.address),
                await pool.getDenormalizedWeight(this.token1.address),
                await pool.totalSupply(),
                await pool.getTotalDenormalizedWeight(),
                poolAmountOut,
                swapFee
            )).toString(10);

            token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();

            await pool.exitswapPoolAmountIn(
                this.token1.address,
                poolAmountOut,
                exitTokenAmountOut,
                {from: alice}
            );

            const exitTokenAmountCommunityFee = mulScalarBN(exitTokenAmountOut, communityExitFee);
            const exitTokenAmountAfterCommunityFee = subBN(exitTokenAmountOut, exitTokenAmountCommunityFee);

            assert.equal((await this.token1.balanceOf(alice)).toString(), exitTokenAmountAfterCommunityFee);
            assert.equal(
                (await this.token1.balanceOf(communityWallet)).toString(),
                addBN(amountCommunityJoinFee, exitTokenAmountCommunityFee)
            );
            assert.equal(
                (await this.token1.balanceOf(pool.address)).toString(),
                subBN(token1PoolBalanceBefore, exitTokenAmountOut)
            );
            assert.equal((await pool.balanceOf(alice)).toString(), '0');
        });

        it('community fee should work properly for joinPool and exitPool', async () => {
            const poolOutAmount = divScalarBN(
                mulScalarBN(amountToSwap, await pool.totalSupply()),
                await pool.getBalance(this.token1.address)
            );
            let ratio = divScalarBN(poolOutAmount, await pool.totalSupply());
            const token1InAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
            const token2InAmount = mulScalarBN(ratio, await pool.getBalance(this.token2.address));

            const poolOutAmountFee = mulScalarBN(poolOutAmount, communityJoinFee);
            const poolOutAmountAfterFee = subBN(poolOutAmount, poolOutAmountFee);

            await this.bActions.joinPool(
                pool.address,
                poolOutAmount,
                [token1InAmount, token2InAmount],
                {from: alice}
            );

            assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
            assert.equal((await this.token2.balanceOf(alice)).toString(), '0');
            assert.equal(
                (await pool.balanceOf(communityWallet)).toString(),
                poolOutAmountFee.toString()
            );
            assert.equal(await this.token1.balanceOf(pool.address), addBN(token1InAmount, balances[0]));
            assert.equal(await this.token2.balanceOf(pool.address), addBN(token2InAmount, balances[1]));
            assert.equal((await pool.balanceOf(alice)).toString(), poolOutAmountAfterFee.toString());

            const poolInAmountFee = mulScalarBN(poolOutAmountAfterFee, communityExitFee);
            const poolInAmountAfterFee = subBN(poolOutAmountAfterFee, poolInAmountFee);

            ratio = divScalarBN(poolInAmountAfterFee, await pool.totalSupply());
            const token1OutAmount = mulScalarBN(ratio, await pool.getBalance(this.token1.address));
            const token2OutAmount = mulScalarBN(ratio, await pool.getBalance(this.token2.address));

            await pool.exitPool(
                poolOutAmountAfterFee,
                [token1OutAmount, token2OutAmount],
                {from: alice}
            );

            assertEqualWithAccuracy((await pool.balanceOf(alice)).toString(), '0');
            assertEqualWithAccuracy((await this.token1.balanceOf(alice)).toString(), token1OutAmount);
            assertEqualWithAccuracy((await this.token2.balanceOf(alice)).toString(), token2OutAmount);
            assertEqualWithAccuracy(
                (await pool.balanceOf(communityWallet)).toString(),
                addBN(poolOutAmountFee, poolInAmountFee).toString()
            );
            assertEqualWithAccuracy(await this.token1.balanceOf(pool.address), subBN(addBN(token1InAmount, balances[0]), token1OutAmount));
            assertEqualWithAccuracy(await this.token2.balanceOf(pool.address), subBN(addBN(token2InAmount, balances[1]), token2OutAmount));
        });

        it('community fee should be zero for address set to without fee restrictions', async () => {
            const poolRestrictions = await PoolRestrictions.new();
            await pool.setRestrictions(poolRestrictions.address, { from: minter });
            await poolRestrictions.setWithoutFee([alice], { from: minter });

            const expectedSwapOutWithoutFee = (await pool.calcOutGivenIn(
                balances[0],
                fromWeights[0],
                balances[1],
                fromWeights[1],
                amountToSwap,
                swapFee
            )).toString(10);

            const price = (await pool.calcSpotPrice(
                addBN(balances[0], amountToSwap),
                fromWeights[0],
                subBN(balances[1], expectedSwapOutWithoutFee),
                fromWeights[1],
                swapFee
            )).toString(10);

            assert.equal((await this.token1.balanceOf(alice)).toString(), amountToSwap.toString());
            const token1PoolBalanceBefore = (await this.token1.balanceOf(pool.address)).toString();
            const token2AliceBalanceBefore = (await this.token2.balanceOf(alice)).toString();

            await this.token1.approve(pool.address, amountToSwap, {from: alice});

            await pool.swapExactAmountIn(
                this.token1.address,
                amountToSwap,
                this.token2.address,
                expectedSwapOutWithoutFee,
                mulScalarBN(price, ether('1.05')),
                {from: alice}
            );

            assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
            assert.equal((await this.token1.balanceOf(communityWallet)).toString(), '0');
            assert.equal(
                (await this.token1.balanceOf(pool.address)).toString(),
                addBN(token1PoolBalanceBefore, amountToSwap)
            );

            assert.equal((await this.token2.balanceOf(alice)).toString(), addBN(token2AliceBalanceBefore, expectedSwapOutWithoutFee).toString());
        });
    })

    it('pool restrictions should work properly', async () => {
        assert.equal((await pool.totalSupply()).toString(10), ether('100').toString(10));

        const poolRestrictions = await PoolRestrictions.new();
        await pool.setRestrictions(poolRestrictions.address, { from: minter });
        await poolRestrictions.setTotalRestrictions([pool.address], [ether('200').toString(10)], { from: minter });

        let amountToMint = ether('50').toString(10);

        let [token1Amount, token2Amount] = await this.getTokensToJoinPoolAndApprove(pool, amountToMint)

        await this.bActions.joinPool(
            pool.address,
            amountToMint,
            [token1Amount, token2Amount]
        );

        assert.equal((await pool.totalSupply()).toString(10), ether('150').toString(10));

        amountToMint = ether('60').toString(10);

        [token1Amount, token2Amount] = await this.getTokensToJoinPoolAndApprove(pool, amountToMint)

        await expectRevert(this.bActions.joinPool(
            pool.address,
            amountToMint,
            [token1Amount, token2Amount]
        ), 'MAX_SUPPLY');
    });

    it('controller should be able to call any voting contract by pool', async () => {
        const poolRestrictions = await PoolRestrictions.new();
        await pool.setRestrictions(poolRestrictions.address, { from: minter });

        assert.equal(await this.token1.delegated(pool.address, pool.address), '0');

        const delegateData = this.token1.contract.methods.delegate(pool.address).encodeABI();
        const delegateSig = delegateData.slice(0, 10);
        await expectRevert(
            pool.callVoting(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', { from: minter }),
            'NOT_ALLOWED_SIG'
        );
        await poolRestrictions.setVotingSignaturesForAddress(this.token1.address, true, [delegateSig], [true], { from: minter });

        await expectRevert(
            pool.callVoting(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', { from: alice }),
            'NOT_CONTROLLER'
        );

        await pool.callVoting(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', { from: minter });

        assert.equal(
            (await this.token1.delegated(pool.address, pool.address)).toString(10),
            (await this.token1.balanceOf(pool.address)).toString(10)
        );

        await poolRestrictions.setVotingSignaturesForAddress(this.token1.address, false, [delegateSig], [false], { from: minter });
        await expectRevert(
            pool.callVoting(this.token1.address, delegateSig, '0x' + delegateData.slice(10), '0', { from: minter }),
            'NOT_ALLOWED_SIG'
        );

        const voting = await MockVoting.new(tokens[0]);
        let proposalReceiptBefore = await voting.getReceipt('1', pool.address);
        assert.equal(proposalReceiptBefore.hasVoted, false);

        const castVoteData = voting.contract.methods.castVote('1', true).encodeABI();
        const castVoteSig = castVoteData.slice(0, 10);
        await expectRevert(
            pool.callVoting(voting.address, castVoteSig, '0x' + castVoteData.slice(10), '0', { from: minter }),
            'NOT_ALLOWED_SIG'
        );
        await poolRestrictions.setVotingSignatures([castVoteSig], [true], { from: minter });

        await pool.callVoting(voting.address, castVoteSig, '0x' + castVoteData.slice(10), '0', { from: minter });

        let proposalReceiptAfter = await voting.getReceipt('1', pool.address);
        assert.equal(proposalReceiptAfter.hasVoted, true);

        const newCastVoteData = voting.contract.methods.castVote('2', true).encodeABI();
        assert.equal(newCastVoteData.slice(0, 10), castVoteSig);

        proposalReceiptBefore = await voting.getReceipt('2', pool.address);
        assert.equal(proposalReceiptBefore.hasVoted, false);

        await poolRestrictions.setVotingSignaturesForAddress(voting.address, true, [castVoteSig], [false], { from: minter });
        await expectRevert(
            pool.callVoting(voting.address, castVoteSig, '0x' + newCastVoteData.slice(10), '0', { from: minter }),
            'NOT_ALLOWED_SIG'
        );

        await poolRestrictions.setVotingSignaturesForAddress(voting.address, false, [castVoteSig], [false], { from: minter });
        await pool.callVoting(voting.address, castVoteSig, '0x' + newCastVoteData.slice(10), '0', { from: minter });

        proposalReceiptAfter = await voting.getReceipt('2', pool.address);
        assert.equal(proposalReceiptAfter.hasVoted, true);

        await expectRevert(
            pool.callVoting(voting.address, castVoteSig, '0x' + newCastVoteData.slice(10), '0', { from: minter }),
            'NOT_SUCCESS'
        );
    });
});
