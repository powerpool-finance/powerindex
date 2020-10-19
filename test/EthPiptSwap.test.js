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

UniswapV2Pair.numberFormat = 'String';
UniswapV2Router02.numberFormat = 'String';
EthPiptSwap.numberFormat = 'String';

const {web3} = BFactory;
const {toBN} = web3.utils;

function mulScalarBN(bn1, bn2) {
    return toBN(bn1.toString(10)).mul(toBN(bn2.toString(10))).div(toBN(ether('1').toString(10))).toString(10);
}
function divScalarBN(bn1, bn2) {
    return toBN(bn1.toString(10)).mul(toBN(ether('1').toString(10))).div(toBN(bn2.toString(10))).toString(10);
}

describe.only('EthPiptSwap', () => {
    const swapFee = ether('0.01');
    const communitySwapFee = ether('0.05');
    const communityJoinFee = ether('0.04');
    const communityExitFee = ether('0.07');

    let minter, bob, carol, alice, feeManager, feeReceiver, permanentVotingPower;
    before(async function() {
        [minter, bob, carol, alice, feeManager, feeReceiver, permanentVotingPower] = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        this.weth = await WETH.new('1');
        this.weth.deposit({value: ether('1000')});

        this.bFactory = await BFactory.new({ from: minter });
        this.bActions = await BActions.new({ from: minter });
        this.uniswapFactory = await UniswapV2Factory.new(feeManager, { from: minter });
        this.uniswapRouter = await UniswapV2Router02.new(this.uniswapFactory.address, this.weth.address, { from: minter });

        this.getTokensToJoinPoolAndApprove = async (_pool, amountToMint) => {
            const poolTotalSupply = (await _pool.totalSupply()).toString(10);
            const ratio = divScalarBN(amountToMint, poolTotalSupply);
            const token1Amount = mulScalarBN(ratio, (await _pool.getBalance(this.token1.address)).toString(10));
            const token2Amount = mulScalarBN(ratio, (await _pool.getBalance(this.token2.address)).toString(10));
            await this.token1.approve(this.bActions.address, token1Amount);
            await this.token2.approve(this.bActions.address, token2Amount);
            return [token1Amount, token2Amount];
        }

        this.getPairsBuyByEth = async (eth, pairs) => {
            const ethShare = eth / pairs.length;
            const result = [];
            for (let i = 0; i < pairs.length; i++) {
                const reserves = await pairs[i].getReserves();
                result[i] = await this.uniswapRouter.getAmountOut(
                    ether(ethShare.toString(10)).toString(10),
                    reserves[1].toString(10),
                    reserves[0].toString(10)
                );
            }
            return result;
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

    describe('community fee', () => {
        // balancer pool:
        // Lend: 161038.016
        // YFI: 4.313
        // uniswap pools:
        // Lend reserve0: 6146258.889
        // Lend reserve1: 6402.032
        // YFI reserve0: 425.403
        // YFI reserve1: 16736.456

        it('community fee should work properly for joinPool and exitPool', async () => {
            this.token1 = await MockERC20.new('LEND', 'LEND', ether('100000000'));
            this.token2 = await MockERC20.new('YFI', 'YFI', ether('100000000'));

            const pool = await this.makeBalancerPool([this.token1, this.token2], [1610.38016, 0.04313]);

            const pair1 = await this.makeUniswapPair(this.token1, 61462.58889, 64.02032);
            const pair2 = await this.makeUniswapPair(this.token2, 4.25403, 167.36456);

            const ethPiptSwap = await EthPiptSwap.new(
                this.weth.address,
                pool.address,
                '0',
                feeReceiver,
                feeManager
            );

            await ethPiptSwap.setUniswapPairFor(
                [this.token1.address, this.token2.address],
                [pair1.address, pair2.address]
            );

            const pairsByEth = await this.getPairsBuyByEth(1, [pair1, pair2]);
            console.log('pairsByEth', pairsByEth);

            const ethAndTokensIn = await ethPiptSwap.contract.methods.getEthAndTokensIn(
                ether('1').toString(10),
                [this.token1.address, this.token2.address]
            ).call();

            console.log('ethAndTokensIn', ethAndTokensIn);

            await ethPiptSwap.swapEthToPipt(
                ethAndTokensIn.tokensInPipt,
                ethAndTokensIn.ethInUniswap,
                ethAndTokensIn.poolOut,
                {
                    value: ether('1')
                }
            );
        });
    })
});
