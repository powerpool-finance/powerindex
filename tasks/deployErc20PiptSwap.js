require('@nomiclabs/hardhat-truffle5');

task('deploy-erc20-pipt-swap', 'Deploy Erc20PiptSwap').setAction(async () => {
  const Erc20PiptSwap = await artifacts.require('Erc20PiptSwap');
  const PowerIndexPool = await artifacts.require('PowerIndexPool');

  const { web3 } = Erc20PiptSwap;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };
  const admin = '0xb258302c3f209491d604165549079680708581cc';
  const poolAddress = '0x26607aC599266b21d13c7aCF7942c7701a8b699c';
  const uniswapFactoryAddress = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';

  const pool = await PowerIndexPool.at(poolAddress);

  const erc20PiptSwap = await Erc20PiptSwap.new(
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1',
    poolAddress,
    admin,
    sendOptions
  );
  console.log('erc20PiptSwap', erc20PiptSwap.address);

  const swapCoins = [
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', //USDT
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', //USDC
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', //DAI
    '0x1494CA1F11D487c2bBe4543E90080AeBa4BA3C2b', //DPI
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', //WBTC
  ];

  await erc20PiptSwap.fetchUnswapPairsFromFactory(
    uniswapFactoryAddress,
    (await callContract(pool, 'getCurrentTokens')).concat(swapCoins),
    sendOptions
  );

  await erc20PiptSwap.transferOwnership(admin, sendOptions);
});

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
