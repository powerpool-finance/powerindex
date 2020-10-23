usePlugin('@nomiclabs/buidler-truffle5');

task('deploy-vested-lp-mining', 'Deploy VestedLpMining')
    .setAction(async () => {
            const VestedLPMining = await artifacts.require("VestedLPMining");

            const {web3} = VestedLPMining;

            const proxies = require('../migrations/helpers/proxies')(web3);

            const [deployer] = await web3.eth.getAccounts();
            const CVP = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
            const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
            const PROXY_OWNER = OWNER;
            const RESERVOIR = '0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E';

            const cvpPerBlock = '2659340659340660000';
            const startBlock = '11112627';
            const cvpVestingPeriodInBlocks = '66268';

            const proxyAdmin = await proxies.Admin.new({ from: deployer });
            console.log('proxyAdmin.address', proxyAdmin.address);
            const vLpMiningImpl = await VestedLPMining.new({ from: deployer });
            console.log('vLpMiningImpl.address', vLpMiningImpl.address);
            const vLpMiningProxy = await proxies.VestedLpMiningProxy(
                vLpMiningImpl.address,
                proxyAdmin.address,
                [ CVP, RESERVOIR, cvpPerBlock, startBlock, cvpVestingPeriodInBlocks ],
                { from: deployer },
            );
            console.log('vLpMiningProxy.address', vLpMiningProxy.address);

            await proxyAdmin.transferOwnership(PROXY_OWNER);
            await vLpMiningProxy.transferOwnership(OWNER);
    });