const Migrations = artifacts.require("Migrations");
const MockCvp = artifacts.require("MockCvp");
const LPMining = artifacts.require("LPMining");
const Reservoir = artifacts.require("Reservoir");
const {web3} = Reservoir;

module.exports = function(deployer, network) {
    if(network === 'test') {
        return;
    }
    deployer.then(async () => {
        const cvpPerBlock = '2';
        const startBlock = await web3.eth.getBlockNumber();

        const reservoir = await deployer.deploy(Reservoir);

        let cvpAddress;
        if(network === 'mainnet') {
            cvpAddress = '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1';
        } else {
            const mockCvp = await deployer.deploy(MockCvp);
            cvpAddress = mockCvp.address;
            await mockCvp.transfer(reservoir.address, web3.utils.toWei('100000', 'ether'));
        }

        await deployer.deploy(LPMining, cvpAddress, reservoir.address, web3.utils.toWei(cvpPerBlock, 'ether'), startBlock);
    })
};
