const fs = require('fs');

const { expectRevert, time, ether } = require('@openzeppelin/test-helpers');
const BFactory = artifacts.require('BFactory');
const BActions = artifacts.require('BActions');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const UniswapV2Factory = artifacts.require('MockUniswapV2Factory');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');
const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
const WETH = artifacts.require('MockWETH');
const EthPiptSwap = artifacts.require('EthPiptSwap');
const PoolRestrictions = artifacts.require('PoolRestrictions');

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

    const poolsData = JSON.parse(fs.readFileSync('data/poolsData.json', {encoding: 'utf8'}));

    const gasPrice = 1000000000;

    let minter, bob, carol, alice, feeManager, feeReceiver, permanentVotingPower;
    before(async function() {
        [minter, bob, carol, alice, feeManager, feeReceiver, permanentVotingPower] = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        this.weth = await WETH.new();
        this.weth.deposit({value: ether('500000')});

        this.bFactory = await BFactory.new({ from: minter });
        this.bActions = await BActions.new({ from: minter });
        this.uniswapFactory = await UniswapV2Factory.new(feeManager, { from: minter });
        this.uniswapRouter = await UniswapV2Router02.new(this.uniswapFactory.address, this.weth.address, { from: minter });

        this.poolRestrictions = await PoolRestrictions.new();

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
                await tokens[i].approve(this.bActions.address, '0x' + 'f'.repeat(64));
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
            const pool = await BPool.at(logNewPool.args.pool);
            await pool.setRestrictions(this.poolRestrictions.address, { from: minter });
            return pool;
        }

        this.makeUniswapPair = async (token, tokenBalance, wethBalance) => {
            const res = await this.uniswapFactory.createPairMock(token.address, this.weth.address);
            const pair = await UniswapV2Pair.at(res.logs[0].args.pair);
            await token.transfer(pair.address, ether(tokenBalance.toString(10)));
            await this.weth.transfer(pair.address, ether(wethBalance.toString(10)));
            await pair.mint(minter);
            return pair;
        }
    });

    describe('swapEthToPipt', () => {
        it('swapEthToPipt should work properly', async () => {
            const tokens = [];
            const pairs = [];
            const bPoolBalances = [];
            let cvpPair;
            for(let i = 0; i < poolsData.length; i++) {
                const token = await MockERC20.new(poolsData[i].tokenSymbol, poolsData[i].tokenSymbol, ether('10000000000'));

                const pair = await this.makeUniswapPair(
                    token,
                    poolsData[i].uniswapPair.tokenReserve,
                    poolsData[i].uniswapPair.ethReserve
                );
                tokens.push(token);
                pairs.push(pair);
                bPoolBalances.push(poolsData[i].balancerBalance);
                if (poolsData[i].tokenSymbol === 'CVP') {
                    this.cvp = token;
                    cvpPair = pair;
                }
                // if(i > 2) {
                //     break;
                // }
            }

            const pool = await this.makeBalancerPool(tokens, bPoolBalances);

            const ethPiptSwap = await EthPiptSwap.new(
                this.weth.address,
                this.cvp.address,
                pool.address,
                feeManager,
                { from: minter }
            );

            await expectRevert(ethPiptSwap.setFees([ether('1')], [ether('0.1')], bob, bob, {from: minter}), 'NOT_FEE_MANAGER');
            await expectRevert(ethPiptSwap.setFees([ether('1')], [ether('0.1')], bob, bob, {from: bob}), 'NOT_FEE_MANAGER');

            await ethPiptSwap.setFees([ether('0.2'), ether('0.1')], [ether('0.02'), ether('0.01')], feeReceiver, feeManager, {from: feeManager});

            await expectRevert(ethPiptSwap.setTokensSettings(
                tokens.map(t => t.address),
                pairs.map(p => p.address),
                pairs.map(p => true),
                {from: bob}
            ), 'Ownable: caller is not the owner');

            await ethPiptSwap.setTokensSettings(
                tokens.map(t => t.address),
                pairs.map(p => p.address),
                pairs.map(p => true),
                { from: minter }
            );

            const {ethFee: ethFee2, ethAfterFee: ethAfterFee2} = await ethPiptSwap.calcEthFee(ether('0.1'));
            assert.equal(ethFee2, ether('0.001').toString(10));
            assert.equal(ethAfterFee2, ether('0.099').toString(10));

            const ethToSwap = ether('600').toString(10);
            const slippage = ether('0.02');

            const {ethFee, ethAfterFee} = await ethPiptSwap.calcEthFee(ethToSwap);
            // assert.equal(ethFee, ether('0.2').toString(10));
            // assert.equal(ethAfterFee, ether('9.8').toString(10));

            const ethAndTokensIn = await ethPiptSwap.getEthAndTokensIn(ethAfterFee, tokens.map(t => t.address), slippage);

            await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('10').toString(10)], { from: minter });

            await expectRevert(
                ethPiptSwap.swapEthToPipt(slippage, { from: bob, value: ethToSwap, gasPrice }),
                'MAX_SUPPLY'
            );

            await this.poolRestrictions.setTotalRestrictions([pool.address], [ether('200').toString(10)], { from: minter });

            const bobBalanceBefore = await web3.eth.getBalance(bob);

            const {tokenAmountInAfterFee: poolOutAfterFee, tokenAmountFee: poolOutFee} = await pool.calcAmountWithCommunityFee(
                ethAndTokensIn.poolOut,
                communityJoinFee,
                ethPiptSwap.address
            );

            let res = await ethPiptSwap.swapEthToPipt(slippage, {from: bob, value: ethToSwap, gasPrice});

            const weiUsed = res.receipt.gasUsed * gasPrice;
            const balanceAfterWeiUsed = subBN(bobBalanceBefore, weiUsed);
            const oddEth = res.receipt.logs.filter(l => l.event === 'OddEth')[0].args;
            assert.equal(subBN(addBN(balanceAfterWeiUsed, oddEth.amount), ethToSwap), await web3.eth.getBalance(bob));
            assert.equal(await this.weth.balanceOf(ethPiptSwap.address), ethFee);

            const swap = res.receipt.logs.filter(l => l.event === 'EthToPiptSwap')[0].args;
            assert.equal(swap.ethSwapAmount, ethAfterFee);
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
            assert.equal(payoutCVP.wethAmount, ethFee);

            for(let i = 0; i < tokens.length; i++) {
                assert.notEqual(await tokens[i].balanceOf(ethPiptSwap.address), '0');
            }
            await ethPiptSwap.convertOddToCvpAndSendToPayout(tokens.map(t => t.address), { from: bob });
            for(let i = 0; i < tokens.length; i++) {
                assert.equal(await tokens[i].balanceOf(ethPiptSwap.address), '0');
            }
            assert.notEqual(await this.cvp.balanceOf(feeReceiver), cvpOutForReceiver);
        });
    })
});
