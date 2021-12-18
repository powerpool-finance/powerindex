require('@nomiclabs/hardhat-truffle5');

task('deploy-erc20-pipt-swap', 'Deploy Erc20PiptSwap').setAction(async (__, { network }) => {
  const Erc20PiptSwap = await artifacts.require('Erc20PiptSwap');
  const PowerIndexPool = await artifacts.require('PowerIndexPool');

  const { web3 } = Erc20PiptSwap;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };
  const admin = '0x560640c19649FD87ca3c5bAde137f6f1cCB9F0B0';
  const poolAddress = '0x40e46de174dfb776bb89e04df1c47d8a66855eb3';
  const uniswapFactoryAddress = '0xca143ce32fe78f1f7019d7d551a6402fc5350c73';
  const wethAddress = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
  const busdAddress = '0xe9e7cea3dedca5984780bafc599bd69add087d56';
  const cvpAddress = '0x5ec3adbdae549dce842e24480eb2434769e22b2e';

  const erc20PiptSwap = await Erc20PiptSwap.at('0xe7a0f13BfAC736976f8f1f7C39433E2b59F8bB52');
  // const erc20PiptSwap = await Erc20PiptSwap.new(
  //   wethAddress,
  //   busdAddress,
  //   cvpAddress,
  //   poolAddress,
  //   admin,
  //   sendOptions
  // );
  console.log('erc20PiptSwap', erc20PiptSwap.address);

  const pool = await PowerIndexPool.at(poolAddress);

  const swapCoins = [
    busdAddress,
  ];

  await erc20PiptSwap.fetchUnswapPairsFromFactory(
    uniswapFactoryAddress,
    wethAddress,
    [
      '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63',
      '0xA7f552078dcC247C2684336020c03648500C6d9F',
      '0xa1faa113cbe53436df28ff0aee54275c13b40975',
      '0x67ee3cb086f8a16f34bee3ca72fad36f7db929e2',
      '0x9f589e3eabe42ebc94a44727b3f3531c0c877809',
    ].concat(swapCoins),
    '25',
    sendOptions
  );

  await erc20PiptSwap.fetchUnswapPairsFromFactory(
    uniswapFactoryAddress,
    busdAddress,
    [
      '0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F',
      '0x762539b45A1dCcE3D36d080F74d1AED37844b878',
    ],
    '25',
    sendOptions
  );

  await erc20PiptSwap.fetchUnswapPairsFromFactory(
    '0xbcfccbde45ce874adcb698cc183debcf17952812',
    wethAddress,
    ['0xa184088a740c695e156f91f5cc086a06bb78b827'],
    '20',
    sendOptions
  );

  await erc20PiptSwap.fetchUnswapPairsFromFactory(
    '0x3cd1c46068daea5ebb0d3f55f6915b10648062b8',
    wethAddress,
    ['0x9C65AB58d8d978DB963e63f2bfB7121627e3a739'],
    '30',
    sendOptions
  );

  await erc20PiptSwap.fetchUnswapPairsFromFactory(
    '0x01bf7c66c6bd861915cdaae475042d3c4bae16a7',
    wethAddress,
    ['0xE02dF9e3e622DeBdD69fb838bB799E3F168902c5'],
    '30',
    sendOptions
  );

  await erc20PiptSwap.setSimplePairs(
    ['0xc2eed0f5a0dc28cfa895084bc0a9b8b8279ae492'],
    true,
    sendOptions
  );

  // await erc20PiptSwap.transferOwnership(admin, sendOptions);

  if (network.name !== 'mainnetfork') {
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
