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
  const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const cvpAddress = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';

  const erc20PiptSwap = await Erc20PiptSwap.new(
    wethAddress,
    cvpAddress,
    poolAddress,
    admin,
    sendOptions
  );
  console.log('erc20PiptSwap', erc20PiptSwap.address);

  const pool = await PowerIndexPool.at(poolAddress);

  const swapCoins = [
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', //USDT
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', //USDC
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', //DAI
    '0x1494CA1F11D487c2bBe4543E90080AeBa4BA3C2b', //DPI
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', //WBTC
    '0xc944e90c64b2c07662a292be6244bdf05cda44a7', //GRT
  ];
  await erc20PiptSwap.fetchUnswapPairsFromFactory(
    uniswapFactoryAddress,
    (await callContract(pool, 'getCurrentTokens')).concat(swapCoins),
    sendOptions
  );

  await erc20PiptSwap.transferOwnership(admin, sendOptions);

  const networkId = await web3.eth.net.getId();
  if (networkId === 1) {
    return;
  }
  const UniswapV2Router02 = await artifacts.require('UniswapV2Router02');
  const uniswapRouter = await UniswapV2Router02.at('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
  const timestamp = Math.round(new Date().getTime() / 1000);
  // swap for usdt
  await uniswapRouter.swapExactETHForTokens('1', [wethAddress, swapCoins[0]], deployer, timestamp + 120, {
    value: web3.utils.toWei('10', 'ether')
  });
  // swap for usdc
  await uniswapRouter.swapExactETHForTokens('1', [wethAddress, swapCoins[1]], deployer, timestamp + 120, {
    value: web3.utils.toWei('10', 'ether')
  });
  const MockERC20 = await artifacts.require('MockERC20');
  const usdt = await MockERC20.at(swapCoins[0]);
  const usdc = await MockERC20.at(swapCoins[1]);

  const usdAmount = web3.utils.toWei('100', 'mwei');
  const slippage = web3.utils.toWei('0.02', 'ether');

  console.log('balance before', await etherBalance(web3, pool, deployer), await etherBalance(web3, usdt, deployer));
  await usdt.approve(erc20PiptSwap.address, usdAmount)
  await erc20PiptSwap.swapErc20ToPipt(usdt.address, usdAmount, slippage);
  console.log('balance after', await etherBalance(web3, pool, deployer), await etherBalance(web3, usdt, deployer));

  console.log('balance before', await etherBalance(web3, pool, deployer), await etherBalance(web3, usdc, deployer));
  await usdc.approve(erc20PiptSwap.address, usdAmount)
  await erc20PiptSwap.swapErc20ToPipt(usdc.address, usdAmount, slippage);
  console.log('balance after', await etherBalance(web3, pool, deployer), await etherBalance(web3, usdc, deployer));
});

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}

async function etherBalance(web3, contract, account) {
  const decimals = (await callContract(contract, 'decimals', [])).toString();
  return web3.utils.fromWei(await callContract(contract, 'balanceOf', [account]), decimals === '6' ? 'mwei' : 'ether');
}
