require('@nomiclabs/hardhat-truffle5');

task('deploy-erc20-pipt-swap', 'Deploy Erc20PiptSwap').setAction(async () => {
  const Erc20PiptSwap = await artifacts.require('Erc20PiptSwap');

  const { web3 } = Erc20PiptSwap;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };
  const admin = '0xb258302c3f209491d604165549079680708581cc';

  const erc20PiptSwap = await Erc20PiptSwap.new(
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1',
    '0x9FAc54B1ddAC9968Df67B31F217c63C4c118656d',
    admin,
    sendOptions
  );
  console.log('erc20PiptSwap', erc20PiptSwap.address);

  await erc20PiptSwap.transferOwnership(admin, sendOptions);
});

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
