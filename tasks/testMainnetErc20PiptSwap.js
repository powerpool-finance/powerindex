require('@nomiclabs/hardhat-truffle5');

task('test-mainnet-erc20-pipt-swap', 'Test Mainnet Erc20PiptSwap').setAction(async () => {
  const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const cvpAddress = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
  const balancerPoolAddress = '0x26607aC599266b21d13c7aCF7942c7701a8b699c';
  const uniswapFactoryAddress = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';

  const Erc20PiptSwap = artifacts.require('Erc20PiptSwap');
  const PowerIndexPool = artifacts.require('PowerIndexPool');

  const { web3 } = Erc20PiptSwap;
  const { toWei } = web3.utils;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const pool = await PowerIndexPool.at(balancerPoolAddress);

  const newPiptSwap = await Erc20PiptSwap.new(
    wethAddress,
    cvpAddress,
    balancerPoolAddress,
    '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
    sendOptions
  );

  await newPiptSwap.setUniswapFactoryAllowed([uniswapFactoryAddress], [true], sendOptions);
  await newPiptSwap.fetchUnswapPairsFromFactory(
    uniswapFactoryAddress,
    await callContract(pool, 'getCurrentTokens'),
    sendOptions
  );

  console.log('before pipt balance', await callContract(pool, 'balanceOf', [sendOptions.from]));
  await newPiptSwap.swapEthToPipt(ether('0.02'), {
    ...sendOptions,
    value: ether('5')
  });
  console.log('after pipt balance', await callContract(pool, 'balanceOf', [sendOptions.from]));

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});

async function callContract(contract, method, args = [], type = null) {
  console.log(method, args);
  let result = await contract.contract.methods[method].apply(contract.contract, args).call();
  if (type === 'array') {
    result = [].concat(result);
  }
  return result;
}

module.exports = {};
