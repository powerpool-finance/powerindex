const MockERC20 = artifacts.require("MockERC20");
const MockCvp = artifacts.require("MockCvp");
const LPMining = artifacts.require("LPMining");
const Reservoir = artifacts.require("Reservoir");
const BFactory = artifacts.require("BFactory");
const BActions = artifacts.require("BActions");
const WETH = artifacts.require("WETH");

WETH.numberFormat = 'String';

const {web3} = MockERC20;
const {toBN, toWei} = web3.utils;

module.exports = function(deployer, network, accounts) {
    if(network === 'test' || network === 'mainnet') {
        return;
    }

    deployer.then(async () => {
        const weth = await WETH.deployed();
        const bFactory = await BFactory.deployed();
        const bActions = await BActions.deployed();
        const lpMining = await LPMining.deployed();

        let mockCvp;
        if(process.env.CVP) {
            mockCvp = await MockCvp.at(process.env.CVP);
        } else {
            mockCvp = await MockCvp.deployed();
        }
        const lendToken = await deployer.deploy(MockERC20, 'LEND', 'LEND', ether(10e6));
        const compToken = await deployer.deploy(MockERC20, 'COMP', 'COMP', ether(10e6));
        const yfiToken = await deployer.deploy(MockERC20, 'YFI', 'YFI', ether(10e6));
        const umaToken = await deployer.deploy(MockERC20, 'UMA', 'UMA', ether(10e6));
        const mkrToken = await deployer.deploy(MockERC20, 'MKR', 'MKR', ether(10e6));
        const uniToken = await deployer.deploy(MockERC20, 'UNI', 'UNI', ether(10e6));
        const crvToken = await deployer.deploy(MockERC20, 'CRV', 'CRV', ether(10e6));
        const snxToken = await deployer.deploy(MockERC20, 'SNX', 'SNX', ether(10e6));

        const pairs = [{
            //     name: 'WETH-CVP',
            //     symbol: 'WETH-CVP',
            //     tokens: [weth.address, mockCvp.address],
            //     balances: [50, 500],
            //     denorms: [25, 25],
            //     swapFee: 0.05,
            //     miningVotes: true
            // },{
            //     name: 'WETH-LEND',
            //     symbol: 'WETH-LEND',
            //     tokens: [weth.address, lendToken.address],
            //     balances: [50, 1000],
            //     denorms: [25, 25],
            //     swapFee: 0.05,
            //     miningVotes: true
            // },{
            //     name: 'WETH-COMP',
            //     symbol: 'WETH-COMP',
            //     tokens: [weth.address, compToken.address],
            //     balances: [50, 2000],
            //     denorms: [25, 25],
            //     swapFee: 0.05,
            //     miningVotes: true
            // },{
            //     name: 'WETH-YFI',
            //     symbol: 'WETH-YFI',
            //     tokens: [weth.address, yfiToken.address],
            //     balances: [50, 200],
            //     denorms: [25, 25],
            //     swapFee: 0.05,
            //     miningVotes: true
            // },{
            name: 'Power Pool Token',
            symbol: 'PPT',
            tokens: [lendToken.address, yfiToken.address, compToken.address, umaToken.address, mkrToken.address, uniToken.address, crvToken.address, snxToken.address],
            balances: [50, 10, 100, 200, 150, 75, 125, 60],
            denorms: [6.25, 6.25, 6.25, 6.25, 6.25, 6.25, 6.25, 6.25],
            swapFee: 0.0002,
            communityFee: 0.0001,
            communityFeeReceiver: '0xc979e468038435E2a08d4724198dDDD4d9811452',
            miningVotes: false
        }];

        for(let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];

            for(let i = 0; i < pair.tokens.length; i++) {
                const pairToken = await MockERC20.at(pair.tokens[i]);
                await pairToken.approve(bActions.address, ether(pair.balances[i]));
            }

            const res = await bActions.create(
                bFactory.address,
                pair.name,
                pair.symbol,
                pair.tokens,
                pair.balances.map(b => ether(b)),
                pair.denorms.map(d => ether(d)),
                [ether(pair.swapFee), ether(pair.communityFee)],
                pair.communityFeeReceiver,
                true
            );

            const logNewPool = BFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
            await lpMining.add('50', logNewPool.args.pool, '1', pair.miningVotes, true);
        }

        // await lpMining.transferOwnership(deployer);
        // await reservoir.transferOwnership(deployer);
    })
};

function ether(amount) {
    return toWei(amount.toString(), 'ether');
}