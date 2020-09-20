const BFactory = artifacts.require("BFactory");
const ExchangeProxy = artifacts.require("ExchangeProxy");
const BActions = artifacts.require("BActions");
const WETH = artifacts.require("WETH");
const {web3} = WETH;
const {toBN} = web3.utils;

module.exports = function(deployer, network) {
    if(network === 'test' || network === 'mainnet') {
        return;
    }
    deployer.then(async () => {
        let wethAddress;
        if(network === 'mainnet') {
            wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
        } else {
            const weth = await deployer.deploy(WETH);
            wethAddress = weth.address;
        }

        const bFactory = await deployer.deploy(BFactory);
        const bActions = await deployer.deploy(BActions);
        const exchangeProxy = await deployer.deploy(ExchangeProxy, wethAddress);
    })
};
