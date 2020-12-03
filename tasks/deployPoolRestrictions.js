require('@nomiclabs/hardhat-truffle5');

task('deploy-pool-restrictions', 'Deploy PoolRestrictions').setAction(async () => {
  const PoolRestrictions = await artifacts.require('PoolRestrictions');

  const { web3 } = PoolRestrictions;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const delegateSig = '0x5c19a95c'; //delegate(address)

  const admin = '0xb258302c3f209491d604165549079680708581cc';

  const poolRestrictions = await PoolRestrictions.new(sendOptions);

  await poolRestrictions.setVotingSignaturesForAddress(
    '0xc00e94cb662c3520282e6f5717214004a7f26888', //COMP
    true,
    [delegateSig],
    [true]
  );

  await poolRestrictions.setVotingSignaturesForAddress(
    '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', //UNI
    true,
    [delegateSig],
    [true]
  );

  await poolRestrictions.setTotalRestrictions(
    ['0x26607aC599266b21d13c7aCF7942c7701a8b699c'],
    ['0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff']
  );

  await poolRestrictions.transferOwnership(admin);
});
