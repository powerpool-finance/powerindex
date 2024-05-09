require('@nomiclabs/hardhat-truffle5');


task('deploy-bsc-deprecated-pools-lens', 'Deploy deprecated pools lens').setAction(async (__, {network}) => {
  const PoolsLens = artifacts.require('DeprecatedBscPoolsLens');

  const { web3 } = PoolsLens;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };
  const poolsLens = await PoolsLens.new(
    '0x40E46dE174dfB776BB89E04dF1C47d8a66855EB3',
    sendOptions,
  );
  console.log('Deprecated bsc pools lens deployed address: ', poolsLens.address);
});
