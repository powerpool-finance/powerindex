usePlugin('@nomiclabs/buidler-truffle5');

const pIteration = require('p-iteration');

task('deploy-vested-lp-powerindex-mining', 'Deploy VestedLpMining').setAction(async () => {
  const VestedLPMining = await artifacts.require('VestedLPMining');

  const { web3 } = VestedLPMining;

  const proxies = require('../migrations/helpers/proxies')(web3);

  const [deployer] = await web3.eth.getAccounts();
  const sendOptions = { from: deployer };

  const oldMining = '0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC';
  const oldLpMining = await VestedLPMining.at(oldMining);
  await oldLpMining.massUpdatePools(sendOptions);

  const CVP = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
  const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
  const PROXY_OWNER = OWNER;
  const RESERVOIR = '0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E';

  const cvpPerBlock = '2659340659340660000';
  const startBlock = '11120828';
  const cvpVestingPeriodInBlocks = '650000';

  const proxyAdmin = await proxies.Admin.new(sendOptions);
  console.log('proxyAdmin.address', proxyAdmin.address);
  const vLpMiningImpl = await VestedLPMining.new(sendOptions);
  console.log('vLpMiningImpl.address', vLpMiningImpl.address);
  const vLpMiningProxy = await proxies.VestedLpMiningProxy(
    vLpMiningImpl.address,
    proxyAdmin.address,
    [CVP, RESERVOIR, cvpPerBlock, startBlock, cvpVestingPeriodInBlocks],
    sendOptions,
  );
  console.log('vLpMiningProxy.address', vLpMiningProxy.address);

  const vLpMining = await VestedLPMining.at(vLpMiningProxy.address);

  const pools = [
    { address: '0x12D4444f96C644385D8ab355F6DDf801315b6254', allocPoint: '71341', votesEnabled: true, poolType: '1' },
    { address: '0xBd7A8f648262b6Cb29D38b575df9F27E6cDeCDE1', allocPoint: '570', votesEnabled: true, poolType: '2' },
    { address: '0x10d9b57F769fbb355CDC2f3C076A65a288dDC78e', allocPoint: '2111', votesEnabled: true, poolType: '2' },
    { address: '0x1Af23B311f203844108137D6EE399109e4981401', allocPoint: '1183', votesEnabled: true, poolType: '2' },
    { address: '0xb2B9335791346E94245DCd316A9C9ED486E6dD7f', allocPoint: '9918', votesEnabled: true, poolType: '3' },
    { address: '0x898D4e3b2978cb6A3c826BC485E519db62c79230', allocPoint: '14877', votesEnabled: false, poolType: '1' },
  ];

  await pIteration.forEachSeries(pools, p => {
    console.log(p.address, 'p.allocPoint', p.allocPoint);
    return vLpMining.add(p.allocPoint, p.address, p.poolType, p.votesEnabled, sendOptions);
  });

  await proxyAdmin.transferOwnership(PROXY_OWNER, sendOptions);
  await vLpMining.transferOwnership(OWNER, sendOptions);
});
