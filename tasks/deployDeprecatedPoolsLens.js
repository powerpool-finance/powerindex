require('@nomiclabs/hardhat-truffle5');


task('deploy-deprecated-pools-lens', 'Deploy deprecated pools lens').setAction(async (__, {network}) => {
  const PoolsLens = artifacts.require('DeprecatedPoolsLens');

  const { web3 } = PoolsLens;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };
  const poolsLens = await PoolsLens.new(
    '0xF09232320eBEAC33fae61b24bB8D7CA192E58507',
    '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1',
    sendOptions,
  );
  console.log('Deprecated pools lens deployed address: ', poolsLens.address);
});
