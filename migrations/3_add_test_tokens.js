const MockERC20 = artifacts.require("MockERC20");
const MockCvp = artifacts.require("MockCvp");
const LPMining = artifacts.require("LPMining");
const {web3} = MockERC20;
const {toBN} = web3.utils;

module.exports = function(deployer, network) {
    if(network === 'test') {
        return;
    }
    deployer.then(async () => {
        const mockCvp = await MockCvp.deployed();
        const lpMining = await LPMining.deployed();

        const testLpTokens = [{
            name: 'Test Uniswap LP',
            symbol: 'TULP',
            totalSupply: '7328144141896050392757',
            cvpBalance: '86020293161340946118644'
        },{
            name: 'Test Balancer LP',
            symbol: 'TBLP',
            totalSupply: '330760948517036974852',
            cvpBalance: '57468821235081673612260'
        }];

        for(let i = 0; i < testLpTokens.length; i++) {
            const testLpToken = await deployer.deploy(MockERC20, testLpTokens[i].symbol, testLpTokens[i].name, testLpTokens[i].totalSupply);
            await mockCvp.transfer(testLpToken.address, testLpTokens[i].cvpBalance);

            const lpTokenPart = toBN(testLpTokens[i].totalSupply).div(toBN('10'));
            await testLpToken.transfer('0xE8bdC4438084da9Ad4e0a154C58062EAA969ab15', lpTokenPart);
            await testLpToken.transfer('0x0dEdd078d7a64a44B4a7A2BD0Dd6Ca968CF2C099', lpTokenPart);

            await lpMining.add('50', testLpToken.address, true, true);
        }
    })
};
