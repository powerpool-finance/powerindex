const MockERC20 = artifacts.require("MockERC20");
const MockCvp = artifacts.require("MockCvp");
const LPMining = artifacts.require("LPMining");
const Reservoir = artifacts.require("Reservoir");
const {web3} = MockERC20;
const {toBN} = web3.utils;

module.exports = function(deployer, network) {
    if(network === 'test' || network !== 'mainnet') {
        return;
    }
    deployer.then(async () => {
        // const lpMining = await LPMining.deployed();
        // const reservoir = await Reservoir.deployed();
        const reservoir = await Reservoir.at('0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E');
        const lpMining = await LPMining.at('0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC');

        const testLpTokens = [{
            name: 'Uniswap',
            address: '0x12d4444f96c644385d8ab355f6ddf801315b6254',
            poolType: '1'
        },{
            name: 'Balancer 1',
            address: '0xbd7a8f648262b6cb29d38b575df9f27e6cdecde1',
            poolType: '2'
        },{
            name: 'Balancer 2',
            address: '0x10d9b57f769fbb355cdc2f3c076a65a288ddc78e',
            poolType: '2'
        },{
            name: 'Balancer 3',
            address: '0x1af23b311f203844108137d6ee399109e4981401',
            poolType: '2'
        }];

        for(let i = 0; i < testLpTokens.length; i++) {
            console.log('add', testLpTokens[i].name);
            await lpMining.add('10', testLpTokens[i].address, testLpTokens[i].poolType, true, true);
            console.log('done', testLpTokens[i].name);
        }

        const admin = '0xB258302C3f209491d604165549079680708581Cc';

        await lpMining.transferOwnership(admin);
        await reservoir.transferOwnership(admin);
    })
};
