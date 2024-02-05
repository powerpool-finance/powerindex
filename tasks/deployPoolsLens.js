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
    '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    sendOptions,
  );

  console.log('pools lens address is: ', poolsLens.address);
});
