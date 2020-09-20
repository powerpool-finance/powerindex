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

        const pairs = [{
            tokens: [weth.address, mockCvp.address],
            balances: [50, 500],
            denorms: [25, 25],
            swapFee: 0.05,
            miningVotes: true
        },{
            tokens: [weth.address, lendToken.address],
            balances: [50, 1000],
            denorms: [25, 25],
            swapFee: 0.05,
            miningVotes: true
        },{
            tokens: [weth.address, compToken.address],
            balances: [50, 2000],
            denorms: [25, 25],
            swapFee: 0.05,
            miningVotes: true
        },{
            tokens: [weth.address, yfiToken.address],
            balances: [50, 200],
            denorms: [25, 25],
            swapFee: 0.05,
            miningVotes: true
        }]

        for(let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];

            await weth.deposit({value: ether(pair.balances[0] / 10e3)});
            await weth.approve(bActions.address, ether(pair.balances[0]));

            const pairToken = await MockERC20.at(pair.tokens[1]);
            await pairToken.approve(bActions.address, ether(pair.balances[1]));

            const res = await bActions.create(
                bFactory.address,
                pair.tokens,
                pair.balances.map(b => ether(b)),
                pair.denorms.map(d => ether(d)),
                ether(pair.swapFee),
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