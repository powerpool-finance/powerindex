const { expectRevert, time, ether } = require('@openzeppelin/test-helpers');
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
const WETH = artifacts.require('MockWETH');
const EthPiptSwap = artifacts.require('EthPiptSwap');

MockERC20.numberFormat = 'String';
UniswapV2Pair.numberFormat = 'String';
UniswapV2Router02.numberFormat = 'String';
EthPiptSwap.numberFormat = 'String';
BPool.numberFormat = 'String';

const {web3} = BFactory;
const {toBN} = web3.utils;

function subBN(bn1, bn2) {
    return toBN(bn1.toString(10)).sub(toBN(bn2.toString(10))).toString(10);
}
function addBN(bn1, bn2) {
    return toBN(bn1.toString(10)).add(toBN(bn2.toString(10))).toString(10);
}

describe('EthPiptSwap', () => {
    const swapFee = ether('0.01');
    const communitySwapFee = ether('0.05');
    const communityJoinFee = ether('0.04');
    const communityExitFee = ether('0.07');

    const gasPrice = 1000000000;

    let minter, bob, carol, alice, feeManager, feeReceiver, permanentVotingPower;
    before(async function() {
        [minter, bob, carol, alice, feeManager, feeReceiver, permanentVotingPower] = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        this.weth = await WETH.new();
        this.weth.deposit({value: ether('1000')});

        this.bFactory = await BFactory.new({ from: minter });
        this.bActions = await BActions.new({ from: minter });
        this.uniswapFactory = await UniswapV2Factory.new(feeManager, { from: minter });
        this.uniswapRouter = await UniswapV2Router02.new(this.uniswapFactory.address, this.weth.address, { from: minter });

        this.getPairAmountOut = async (pair, amountIn, inWeth = true) => {
            const reserves = await pair.getReserves();
            return this.uniswapRouter.getAmountOut(
                amountIn,
                inWeth ? reserves[1].toString(10) : reserves[0].toString(10),
                inWeth ? reserves[0].toString(10) : reserves[1].toString(10)
            );
        }

        this.makeBalancerPool = async (tokens, balances) => {
            for (let i = 0; i < tokens.length; i++) {
                await tokens[i].approve(this.bActions.address, ether(balances[i].toString(10)));
            }

            const weightPart = 50 / tokens.length;
            const res = await this.bActions.create(
                this.bFactory.address,
                'My Pool',
                'MP',
                tokens.map(t => t.address),
                balances.map(b => ether(b.toString(10))),
                tokens.map(t => ether(weightPart.toString(10))),
                [swapFee, communitySwapFee, communityJoinFee, communityExitFee],
                permanentVotingPower,
                true
            );

            const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
            return BPool.at(logNewPool.args.pool);
        }

        this.makeUniswapPair = async (token, tokenBalance, wethBalance) => {
            const res = await this.uniswapFactory.createPair(token.address, this.weth.address);
            const pair = await UniswapV2Pair.at(res.logs[0].args.pair);
            await token.transfer(pair.address, ether(tokenBalance.toString(10)));
            await this.weth.transfer(pair.address, ether(wethBalance.toString(10)));
            await pair.mint(minter);
            return pair;
        }
    });

    describe('swapEthToPipt', () => {
        // balancer pool:
        // Lend: 161038.016
        // YFI: 4.313
        // uniswap pools:
        // Lend reserve0: 6146258.889
        // Lend reserve1: 6402.032
        // YFI reserve0: 425.403
        // YFI reserve1: 16736.456
        // CVP reserve0: 6072.57692
        // CVP reserve1: 26.88494

        it('swapEthToPipt should work properly', async () => {
            this.cvp = await MockERC20.new('CVP', 'CVP', ether('100000000'));
            this.token1 = await MockERC20.new('LEND', 'LEND', ether('100000000'));
            this.token2 = await MockERC20.new('YFI', 'YFI', ether('100000000'));

            const pool = await this.makeBalancerPool([this.token1, this.token2], [1610.38016, 0.04313]);

            const pair1 = await this.makeUniswapPair(this.token1, 61462.58889, 64.02032);
            const pair2 = await this.makeUniswapPair(this.token2, 4.25403, 167.36456);
            const cvpPair = await this.makeUniswapPair(this.cvp, 6072.57692, 26.88494);

            const ethPiptSwap = await EthPiptSwap.new(
                this.weth.address,
                this.cvp.address,
                pool.address,
                feeManager,
                { from: minter }
            );

            await expectRevert(ethPiptSwap.setFees([ether('1')], [ether('0.1')], bob, bob, {from: minter}), 'NOT_FEE_MANAGER');
            await expectRevert(ethPiptSwap.setFees([ether('1')], [ether('0.1')], bob, bob, {from: bob}), 'NOT_FEE_MANAGER');

            await ethPiptSwap.setFees([ether('0.1'), ether('0.2')], [ether('0.01'), ether('0.02')], feeReceiver, feeManager, {from: feeManager});

            const tokens = [this.token1, this.token2];
            const pairs = [pair1, pair2];
            await expectRevert(ethPiptSwap.setUniswapPairFor(
                tokens.map(t => t.address).concat([this.cvp.address]),
                pairs.map(p => p.address).concat([cvpPair.address]),
                {from: bob}
            ), 'Ownable: caller is not the owner');

            await ethPiptSwap.setUniswapPairFor(
                [this.token1.address, this.token2.address, this.cvp.address],
                [pair1.address, pair2.address, cvpPair.address],
                { from: minter }
            );

            const ethToSwap = ether('0.1').toString(10);

            const {ethFee, ethAfterFee} = await ethPiptSwap.calcEthFee(ethToSwap);
            assert.equal(ethFee, ether('0.001').toString(10));
            assert.equal(ethAfterFee, ether('0.099').toString(10));

            const {ethFee: ethFee2, ethAfterFee: ethAfterFee2} = await ethPiptSwap.calcEthFee(ether('0.2'));
            assert.equal(ethFee2, ether('0.004').toString(10));
            assert.equal(ethAfterFee2, ether('0.196').toString(10));

            const ethAndTokensIn = await ethPiptSwap.getEthAndTokensIn(
                ethAfterFee,
                [this.token1.address, this.token2.address]
            );

            console.log('ethAndTokensIn', ethAndTokensIn);

            for(let i = 0; i < ethAndTokensIn.ethInUniswap.length; i++) {
                console.log('ethInUniswap', ethAndTokensIn.ethInUniswap[i]);
                console.log('tokensInPipt', ethAndTokensIn.tokensInPipt[i]);
                console.log('tokenOutByEth', await this.getPairAmountOut(pairs[i], ethAndTokensIn.ethInUniswap[i]));
            }

            const bobBalanceBefore = await web3.eth.getBalance(bob);

            //TODO: fix uniswap revert on run multiple tests in the same time
            let res = await ethPiptSwap.swapEthToPipt(
                ethAndTokensIn.tokensInPipt,
                ethAndTokensIn.ethInUniswap,
                ethAndTokensIn.poolOut,
                {
                    from: bob,
                    value: ethToSwap,
                    gasPrice
                }
            );

            const weiUsed = res.receipt.gasUsed * gasPrice;
            const balanceAfterWeiUsed = subBN(bobBalanceBefore, weiUsed);
            const oddEth = res.receipt.logs.filter(l => l.event === 'OddEth')[0].args;
            assert.equal(
                subBN(addBN(balanceAfterWeiUsed, oddEth.amount), ether('0.1')),
                await web3.eth.getBalance(bob)
            );
            assert.equal(await this.weth.balanceOf(ethPiptSwap.address), ethFee);

            const {tokenAmountInAfterFee: poolOutAfterFee, tokenAmountFee: poolOutFee} = await pool.calcAmountWithCommunityFee(
                ethAndTokensIn.poolOut,
                communityJoinFee,
                ethPiptSwap.address
            );

            const swap = res.receipt.logs.filter(l => l.event === 'EthToPiptSwap')[0].args;
            assert.equal(swap.ethAmount, ethToSwap);
            assert.equal(swap.ethFee, ethFee);
            assert.equal(swap.piptAmount, ethAndTokensIn.poolOut);
            assert.equal(swap.piptCommunityFee, poolOutFee);

            assert.equal(poolOutAfterFee, await pool.balanceOf(bob));

            const cvpOutForReceiver = await this.getPairAmountOut(cvpPair, ethFee);

            assert.equal(await this.cvp.balanceOf(feeReceiver), '0');

            // TODO: check msg.sender == tx.origin
            res = await ethPiptSwap.convertOddToCvpAndSendToPayout([], { from: bob });
            assert.equal(await this.cvp.balanceOf(feeReceiver), cvpOutForReceiver);
            assert.equal(await this.weth.balanceOf(ethPiptSwap.address), '0');

            const payoutCVP = res.receipt.logs.filter(l => l.event === 'PayoutCVP')[0].args;
            assert.equal(payoutCVP.wethAmount, swap.ethFee);

            assert.notEqual(await this.token1.balanceOf(ethPiptSwap.address), '0');
            assert.notEqual(await this.token2.balanceOf(ethPiptSwap.address), '0');
            await ethPiptSwap.convertOddToCvpAndSendToPayout([
                this.token1.address,
                this.token2.address
            ], { from: bob });
            assert.equal(await this.token1.balanceOf(ethPiptSwap.address), '0');
            assert.equal(await this.token2.balanceOf(ethPiptSwap.address), '0');
            assert.notEqual(await this.cvp.balanceOf(feeReceiver), cvpOutForReceiver);
        });
    })
});
