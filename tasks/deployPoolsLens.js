require('@nomiclabs/hardhat-truffle5');


task('deploy-pools-lens', 'Deploy pools lens').setAction(async (__, {network}) => {
  const PoolsLens = artifacts.require('PoolsLens');

  const { web3 } = PoolsLens;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };
  const poolsLens = await PoolsLens.new(
    '0xF09232320eBEAC33fae61b24bB8D7CA192E58507',
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1',
    sendOptions,
  );
  console.log('pools lends deployed address: ', poolsLens.address);
});
