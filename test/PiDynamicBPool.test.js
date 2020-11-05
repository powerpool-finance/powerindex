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
    console.log('diff', diff.toString(), 'accuracyWei', accuracyWei.toString());
    assert.equal(diff.lte(toBN(accuracyWei)), true, message);
}

async function getTimestamp(shift = 0) {
    const currentTimestamp = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
    return currentTimestamp + shift;
}

describe.only('PiDynamicBPool', () => {
    const name = 'My Pool';
    const symbol = 'MP';
    const balances = [ether('100'), ether('200')].map(w => w.toString());
    const targetWeights = [ether('25'), ether('15')].map(w => w.toString());
    let fromTimestamps;
    let targetTimestamps;
    const swapFee = ether('0.01');
    const communitySwapFee = ether('0.05');
    const communityJoinFee = ether('0.04');
    const communityExitFee = ether('0.07');
    const minWeightPerSecond = ether('0.00000001');
    const maxWeightPerSecond = ether('0.1');

    let tokens;
    let pool;
    let fromWeights;

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
        targetTimestamps = [await getTimestamp(11000), await getTimestamp(11000)].map(w => w.toString());

        await this.token1.approve(this.bActions.address, balances[0]);
        await this.token2.approve(this.bActions.address, balances[1]);

        const res = await this.bActions.create(
            this.bFactory.address,
            name,
            symbol,
            minWeightPerSecond,
            maxWeightPerSecond,
            tokens.map((t, i) => ({
                token: t,
                balance: balances[i],
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
        fromWeights = [await pool.MIN_WEIGHT(), await pool.MIN_WEIGHT()];

        this.getTokensToJoinPoolAndApprove = async (_pool, amountToMint) => {
            const poolTotalSupply = (await _pool.totalSupply()).toString(10);
            const ratio = divScalarBN(amountToMint, poolTotalSupply);
            const token1Amount = mulScalarBN(ratio, (await _pool.getBalance(this.token1.address)).toString(10));
            const token2Amount = mulScalarBN(ratio, (await _pool.getBalance(this.token2.address)).toString(10));
            await this.token1.approve(this.bActions.address, token1Amount);
            await this.token2.approve(this.bActions.address, token2Amount);
            return [token1Amount, token2Amount];
        };
        this.calcOutGivenIn = async (_tokenIn, _tokenOut, amountIn) => {
            return pool.calcOutGivenIn(
                await pool.getBalance(_tokenIn),
                await getDenormWeight(_tokenIn, await getTimestamp(1)),
                await pool.getBalance(_tokenOut),
                await getDenormWeight(_tokenOut, await getTimestamp(1)),
                amountIn,
                swapFee
            );
        };
        this.calcPoolOutGivenSingleIn = async(_tokenIn, _amountIn) => {
            return pool.calcPoolOutGivenSingleIn(
                await pool.getBalance(_tokenIn),
                await pool.getDenormalizedWeight(_tokenIn),
                await pool.totalSupply(),
                await pool.getTotalDenormalizedWeight(),
                _amountIn,
                swapFee
            )
        }
        this.calcPoolInGivenSingleOut = async(_tokenOut, _amountOut) => {
            return pool.calcPoolInGivenSingleOut(
                await pool.getBalance(_tokenOut),
                await pool.getDenormalizedWeight(_tokenOut),
                await pool.totalSupply(),
                await pool.getTotalDenormalizedWeight(),
                _amountOut,
                swapFee
            )
        }

        this.joinswapExternAmountIn = async(_token, _amountIn) => {
            const amountInFee = mulScalarBN(_amountIn, communitySwapFee);
            const amountInAfterFee = subBN(_amountIn, amountInFee);
            let poolAmountOut = await this.calcPoolOutGivenSingleIn(_token.address, amountInAfterFee);
            console.log('joinswapExternAmountIn', web3.utils.fromWei(_amountIn, 'ether'), '=>', web3.utils.fromWei(poolAmountOut));

            await _token.transfer(alice, _amountIn);
            await _token.approve(pool.address, _amountIn, {from: alice});
            await pool.joinswapExternAmountIn(_token.address, _amountIn, poolAmountOut, {from: alice});
        };

        this.exitswapExternAmountOut = async(_token, _amountOut) => {
            let poolAmountIn = await this.calcPoolInGivenSingleOut(_token.address, _amountOut);

            await pool.transfer(alice, poolAmountIn);
            await pool.approve(pool.address, poolAmountIn, {from: alice});
            await pool.exitswapExternAmountOut(_token.address, _amountOut, poolAmountIn, {from: alice});
        };

        this.multihopBatchSwapExactIn = async(_tokenFrom, _tokenTo, amountToSwap) => {
            const amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
            const amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

            (await MockERC20.at(_tokenFrom)).transfer(alice, amountToSwap);
            (await MockERC20.at(_tokenFrom)).approve(this.bExchange.address, amountToSwap, {from: alice});

            const expectedSwapOut = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
            console.log('expectedSwapOut', web3.utils.fromWei(expectedSwapOut, 'ether'));
            const price = (await pool.calcSpotPrice(
                addBN(await pool.getBalance(tokens[0]), amountToSwap),
                await getDenormWeight(tokens[0], await getTimestamp(1)),
                subBN(await pool.getBalance(tokens[1]), expectedSwapOut),
                await getDenormWeight(tokens[1], await getTimestamp(1)),
                swapFee
            )).toString(10);

            await this.bExchange.multihopBatchSwapExactIn(
                [[{
                    pool: pool.address,
                    tokenIn: _tokenFrom,
                    tokenOut: _tokenTo,
                    swapAmount: amountToSwap,
                    limitReturnAmount: mulScalarBN(expectedSwapOut, ether('0.995')),
                    maxPrice: mulScalarBN(price, ether('1.005'))
                }]],
                _tokenFrom,
                _tokenTo,
                amountToSwap,
                mulScalarBN(expectedSwapOut, ether('0.995')),
                {from: alice}
            );
        };
    });
    async function getDenormWeight(token, timestamp) {
        if (!timestamp) {
            timestamp = await getTimestamp();
        }
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

    async function needTokensBalanceIn(pool, tokens) {
        let totalFromWeights = '0';
        let totalTargetWeights = '0';
        await pIteration.forEachSeries(tokens, async (t, index) => {
            const dw = await pool.getDynamicWeightSettings(t);
            totalFromWeights = addBN(totalFromWeights, dw.fromDenorm);
            totalTargetWeights = addBN(totalTargetWeights, dw.targetDenorm);
        });
        const tokenRatios = [];
        const tokenBalancesNeedIn = [];
        const tokenBalancesNeedInWithFee = [];
        await pIteration.forEachSeries(tokens, async (t, index) => {
            const dw = await pool.getDynamicWeightSettings(t);
            const balance = await pool.getBalance(t);
            tokenRatios[index] = divScalarBN(divScalarBN(dw.targetDenorm, totalTargetWeights), divScalarBN(dw.fromDenorm, totalFromWeights));
            console.log('tokenRatio', web3.utils.fromWei(tokenRatios[index], 'ether'));
            tokenBalancesNeedIn[index] = mulScalarBN(balance, subBN(tokenRatios[index], ether('1')));
            tokenBalancesNeedInWithFee[index] = divScalarBN(tokenBalancesNeedIn[index], subBN(ether('1'), communityJoinFee));
            console.log('tokenBalancesNeedIn[index]', web3.utils.fromWei(tokenBalancesNeedIn[index], 'ether'));
        });
        return tokenBalancesNeedInWithFee;
    }

    it('should set name and symbol for new pool', async () => {
        assert.equal(await pool.name(), name);
        assert.equal(await pool.symbol(), symbol);
        assert.sameMembers(await pool.getCurrentTokens(), tokens);
        assert.deepEqual(_.pick(await pool.getDynamicWeightSettings(tokens[0]), ['fromTimestamp', 'targetTimestamp', 'fromDenorm', 'targetDenorm']), {
            fromTimestamp: fromTimestamps[0],
            targetTimestamp: targetTimestamps[0],
            fromDenorm: await pool.MIN_WEIGHT(),
            targetDenorm: targetWeights[0]
        });
        assert.equal((await pool.getDenormalizedWeight(tokens[0])).toString(), await pool.MIN_WEIGHT());
        assert.equal((await pool.getDenormalizedWeight(tokens[1])).toString(), await pool.MIN_WEIGHT());
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

    describe('test swap after time spent', async () => {
        it(`should correctly swap by multihopBatchSwapExactIn after seconds pass`, async () => {
            await expectRevert(pool.setDynamicWeight(tokens[0], ether('40'), '1', '2', { from: minter }), 'CANT_SET_PAST_TIMESTAMP');
            //TODO: figure out why MAX_WEIGHT_PER_SECOND require message not working in buidler
            await expectRevert.unspecified(pool.setDynamicWeight(tokens[0], ether('40'), fromTimestamps[0], addBN(fromTimestamps[0], '100'), { from: minter }));
            //TODO: figure out why TIMESTAMP_NEGATIVE_DELTA require message not working in buidler
            await expectRevert.unspecified(pool.setDynamicWeight(tokens[0], ether('40'), targetTimestamps[0], fromTimestamps[0], { from: minter }));
            await expectRevert(pool.setDynamicWeight(tokens[0], ether('51'), fromTimestamps[0], targetTimestamps[0], { from: minter }), 'TARGET_WEIGHT_BOUNDS');
            await expectRevert(pool.setDynamicWeight(tokens[0], ether('45'), fromTimestamps[0], targetTimestamps[0], { from: minter }), 'MAX_TARGET_TOTAL_WEIGHT');
            //TODO: figure out why NOT_CONTROLLER require message not working in buidler
            await expectRevert.unspecified(pool.setDynamicWeight(tokens[0], ether('10'), fromTimestamps[0], targetTimestamps[0], { from: alice }));
        });
    });

    describe('test swap after time spent', async () => {
        let amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut;

        beforeEach(async () => {
            amountToSwap = ether('1').toString(10);
            await this.token1.transfer(alice, amountToSwap);
            await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
            await this.token1.approve(this.bExchange.address, amountToSwap, {from: alice});
            await this.token1.approve(this.bActions.address, amountToSwap, {from: alice});
            await this.token2.approve(this.bActions.address, mulScalarBN(amountToSwap, ether('2')), {from: alice});

            amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
            amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);
        });

        for (let sec = 10; sec < 13000; sec += 1000) {
            it(`should correctly swap by multihopBatchSwapExactIn after ${sec} seconds pass`, async () => {
                await time.increase(sec);

                await assertEqualWithAccuracy(await getDenormWeight(tokens[0]), await pool.getDenormalizedWeight(tokens[0]), "Amount to swap restored to values before changing", ether('0.0000000001'));
                await assertEqualWithAccuracy(await getDenormWeight(tokens[1]), await pool.getDenormalizedWeight(tokens[1]), "Amount to swap restored to values before changing", ether('0.0000000001'));

                const etherWeights = await pIteration.map(tokens, async (t) => {
                    return web3.utils.fromWei(await pool.getDenormalizedWeight(t), 'ether');
                })
                console.log('current weights', etherWeights.join(', '));

                await this.multihopBatchSwapExactIn(tokens[0], tokens[1], amountToSwap);

                // assert.equal((await this.token1.balanceOf(alice)).toString(), '0');
                assert.equal(
                    (await this.token1.balanceOf(communityWallet)).toString(),
                    amountCommunitySwapFee.toString()
                );
                // assert.equal(
                //     (await this.token1.balanceOf(pool.address)).toString(),
                //     addBN(token1PoolBalanceBefore, amountAfterCommunitySwapFee)
                // );
                // assert.equal((await this.token2.balanceOf(alice)).toString(), addBN(token2AliceBalanceBefore, expectedSwapOut).toString());
            });
        }
    });

    describe('restoring ratio after weight changing', () => {
        let amountToSwapBefore, amountToSwapAfter, poolAmountOutToken1Before, poolAmountOutToken1After, poolAmountOutToken2Before, poolAmountOutToken2After;
        let amountToSwap, amountCommunitySwapFee, amountAfterCommunitySwapFee, expectedSwapOut, token1BalanceNeedInWithFee, token2BalanceNeedInWithFee;
        beforeEach(async () => {
            amountToSwap = ether('0.1').toString(10);
            amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
            amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

            amountToSwapBefore = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
            poolAmountOutToken1Before = await this.calcPoolOutGivenSingleIn(tokens[0], ether('1'));
            poolAmountOutToken2Before = await this.calcPoolOutGivenSingleIn(tokens[1], ether('1'));
            await time.increase(11000);
            amountToSwapAfter = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
            poolAmountOutToken1After = await this.calcPoolOutGivenSingleIn(tokens[0], ether('1'));
            poolAmountOutToken2After = await this.calcPoolOutGivenSingleIn(tokens[1], ether('1'));

            await this.token1.transfer(alice, amountToSwap);
            await this.token2.transfer(alice, mulScalarBN(amountToSwap, ether('2')));
            await this.token1.approve(this.bExchange.address, amountToSwap, {from: alice});
            await this.token1.approve(this.bActions.address, amountToSwap, {from: alice});
            await this.token2.approve(this.bActions.address, mulScalarBN(amountToSwap, ether('2')), {from: alice});

            expectedSwapOut = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
            [token1BalanceNeedInWithFee, token2BalanceNeedInWithFee] = await needTokensBalanceIn(pool, tokens);
            token2BalanceNeedInWithFee = token2BalanceNeedInWithFee.replace('-', '');

            console.log('amountToSwapBefore', web3.utils.fromWei(amountToSwapBefore, 'ether'));
            console.log('amountToSwapAfter', web3.utils.fromWei(amountToSwapAfter, 'ether'));
            console.log('poolAmountOutToken1Before', web3.utils.fromWei(poolAmountOutToken1Before, 'ether'));
            console.log('poolAmountOutToken1After', web3.utils.fromWei(poolAmountOutToken1After, 'ether'));
            console.log('poolAmountOutToken2Before', web3.utils.fromWei(poolAmountOutToken2Before, 'ether'));
            console.log('poolAmountOutToken2After', web3.utils.fromWei(poolAmountOutToken2After, 'ether'));
        });

        it('balances ratio should be restored by joinswapExternAmountIn and exitswapExternAmountOut', async () => {
            assert.equal(targetWeights[0], await pool.getDenormalizedWeight(tokens[0]));
            assert.equal(targetWeights[1], await pool.getDenormalizedWeight(tokens[1]));

            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));

            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));

            const amountToSwapFixed = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
            const poolAmountOutToken1Fixed = await this.calcPoolOutGivenSingleIn(tokens[0], ether('1'));
            const poolAmountOutToken2Fixed = await this.calcPoolOutGivenSingleIn(tokens[1], ether('1'));

            console.log('amountToSwapFixed', web3.utils.fromWei(amountToSwapFixed, 'ether'));
            console.log('poolAmountOutToken1Fixed', web3.utils.fromWei(poolAmountOutToken1Fixed, 'ether'));
            console.log('poolAmountOutToken2Fixed', web3.utils.fromWei(poolAmountOutToken2Fixed, 'ether'));
            await assertEqualWithAccuracy(amountToSwapBefore, amountToSwapFixed, "Amount to swap restored to values before changing", ether('0.003'));        });

        it('balances ratio should be restored by swapExactAmountIn', async () => {
            assert.equal(targetWeights[0], await pool.getDenormalizedWeight(tokens[0]));
            assert.equal(targetWeights[1], await pool.getDenormalizedWeight(tokens[1]));

            await this.multihopBatchSwapExactIn(tokens[0], tokens[1], divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.multihopBatchSwapExactIn(tokens[0], tokens[1], divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.multihopBatchSwapExactIn(tokens[0], tokens[1], divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.multihopBatchSwapExactIn(tokens[0], tokens[1], divScalarBN(token1BalanceNeedInWithFee, ether('4')));

            const amountToSwapFixed = await this.calcOutGivenIn(tokens[0], tokens[1], amountAfterCommunitySwapFee);
            const poolAmountOutToken1Fixed = await this.calcPoolOutGivenSingleIn(tokens[0], ether('1'));
            const poolAmountOutToken2Fixed = await this.calcPoolOutGivenSingleIn(tokens[1], ether('1'));

            console.log('amountToSwapFixed', web3.utils.fromWei(amountToSwapFixed, 'ether'));
            console.log('poolAmountOutToken1Fixed', web3.utils.fromWei(poolAmountOutToken1Fixed, 'ether'));
            console.log('poolAmountOutToken2Fixed', web3.utils.fromWei(poolAmountOutToken2Fixed, 'ether'));

            await assertEqualWithAccuracy(amountToSwapBefore, amountToSwapFixed, "Amount to swap restored to values before changing", ether('0.003'));
        });
    });

    describe.only('adding and removing token', () => {
        let amountToSwapBefore, token1BalanceNeedInWithFee, token2BalanceNeedInWithFee, token3BalanceNeedInWithFee;
        it('balances ratio should be restored by joinswapExternAmountIn and exitswapExternAmountOut', async () => {
            await time.increase(11000);

            [token1BalanceNeedInWithFee, token2BalanceNeedInWithFee] = await needTokensBalanceIn(pool, tokens);
            token2BalanceNeedInWithFee = token2BalanceNeedInWithFee.replace('-', '');

            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));
            await this.joinswapExternAmountIn(this.token1, divScalarBN(token1BalanceNeedInWithFee, ether('5')));

            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));
            await this.exitswapExternAmountOut(this.token2, divScalarBN(token2BalanceNeedInWithFee, ether('5')));

            const amountToSwap = ether('0.1').toString(10);
            const amountCommunitySwapFee = mulScalarBN(amountToSwap, communitySwapFee);
            const amountAfterCommunitySwapFee = subBN(amountToSwap, amountCommunitySwapFee);

            const fromTimestamp = await getTimestamp(100);
            const targetTimestamp = await getTimestamp(11000);

            const initialBalance = ether('0.0001');
            const targetWeight = ether('10');
            this.token3 = await MockERC20.new('My Token 3', 'MT3', ether('1000000'));
            await this.token3.approve(pool.address, initialBalance);
            await pool.bind(this.token3.address, initialBalance, targetWeight, fromTimestamp, targetTimestamp);

            const amountToSwapBeforeIncrease = await this.calcOutGivenIn(this.token3.address, tokens[1], ether('0.0001'));
            console.log('amountToSwapBeforeIncrease', web3.utils.fromWei(amountToSwapBeforeIncrease, 'ether'));
            assert.equal(amountToSwapBeforeIncrease, ether('0.000000004905778873'));
            const poolAmountOutBeforeIncrease = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
            console.log('poolAmountOutBeforeIncrease', web3.utils.fromWei(poolAmountOutBeforeIncrease, 'ether'));
            assert.equal(poolAmountOutBeforeIncrease, ether('0.00000000253789326'));
            await time.increase(11000);

            const amountToSwapBeforeJoin = await this.calcOutGivenIn(this.token3.address, tokens[1], ether('0.0001'));
            console.log('amountToSwapBeforeJoin', web3.utils.fromWei(amountToSwapBeforeJoin, 'ether'));
            const poolAmountOutAfterIncrease = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
            console.log('poolAmountOutAfterIncrease', web3.utils.fromWei(poolAmountOutAfterIncrease, 'ether'));

            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.0001'));
            await this.joinswapExternAmountIn(this.token3, ether('0.001'));
            const poolAmountOutAfterJoin = await this.calcPoolOutGivenSingleIn(this.token3.address, ether('0.0001'));
            console.log('poolAmountOutAfterJoin', web3.utils.fromWei(poolAmountOutAfterJoin, 'ether'));
            // console.log('amountToSwapFixed', web3.utils.fromWei(amountToSwapFixed, 'ether'));
        });
    });
    // TODO: test weight to 0
    // TODO: minWeightPerSecond
    // TODO: get tokens from mainnet(3 tokens)
});
