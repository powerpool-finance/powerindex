require('@nomiclabs/hardhat-truffle5');


task('deploy-proxy-factory', 'Deploy Proxy Factory').setAction(async (__, {network}) => {
  const ProxyFactory = artifacts.require('ProxyFactory');

  const { web3 } = ProxyFactory;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const proxyFactory = await ProxyFactory.new(sendOptions);

  console.log('proxyFactory', proxyFactory.address);
  if (network.name !== 'mainnetfork') {
    return;
  }
  await proxyFactory.build(
    proxyFactory.address,
    '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb',
    '0x'
  );
});
