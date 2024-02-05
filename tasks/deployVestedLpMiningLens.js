require('@nomiclabs/hardhat-truffle5');


task('deploy-vested-lp-mining-lens', 'Deploy lp lens').setAction(async (__, {network}) => {
  const VestedLPMiningLens = artifacts.require('VestedLpMiningLens');

  const { web3 } = VestedLPMiningLens;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };
  const vestedLPMiningLens = await VestedLPMiningLens.new(
    '0xF09232320eBEAC33fae61b24bB8D7CA192E58507',
    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '0x0000000000000000000000000000000000000000',
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    6,
    sendOptions,
  );

  console.log('lpMiningLens', vestedLPMiningLens.address);
  if (network.name !== 'mainnetfork') {
    return;
  }

  await vestedLPMiningLens.setPiptSwapByPool(
    [
      '0x26607ac599266b21d13c7acf7942c7701a8b699c',
      '0xb2b9335791346e94245dcd316a9c9ed486e6dd7f',
      '0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d',
      '0xfa2562da1bba7b954f26c74725df51fb62646313'
    ],
    [
      '0x471868211E03f0dA24F8576cB546d4276623C67d',
      '0x91AA1D4294FD16629Fe64C570574A550827b832f',
      '0x56FA426e08afce7A9dfddDd42FeDFa64a7ccf7Cb',
      '0x4a323f52685b160576257c968f679bbec5076f36'
    ]
  );
  // const price = await vestedLPMiningLens.getPools.call('0x26607ac599266b21d13c7acf7942c7701a8b699c', 18);
  // console.log('lp token price is: ', price.toString());
  const getPool = await vestedLPMiningLens.getPool.call('0');
  console.log('pool is: ', getPool);
});
