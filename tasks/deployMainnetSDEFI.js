require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-sdefi', 'Deploy sDEFI').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, callContract, mulScalarBN, divScalarBN, zeroAddress} = require('../test/helpers');

  const PowerIndexPoolFactory = await artifacts.require('PowerIndexPoolFactory');
  const PowerIndexPoolActions = await artifacts.require('PowerIndexPoolActions');
  const PowerIndexPool = await artifacts.require('PowerIndexPool');
  const MockERC20 = await artifacts.require('MockERC20');
  const UniswapV2Router02 = await artifacts.require('UniswapV2Router02');
  const Erc20PiptSwap = await artifacts.require('Erc20PiptSwap');

  const { web3 } = PowerIndexPoolFactory;
  const { toWei } = web3.utils;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const uniswapFactoryAddress = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';
  const cvpAddress = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';

  const admin = '0xb258302c3f209491d604165549079680708581cc';

  const bFactory = await PowerIndexPoolFactory.at('0x967D77f1fBb5fD1846Ce156bAeD3AAf0B13020D1');
  const bActions = await PowerIndexPoolActions.at('0xc282f9c362ca10b54d26eb87eb25a7b7d52a7109');
  const poolConfig = {
    name: 'sDEFI',
    symbol: 'sDEFI',
    tokens: [
      {address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', denorm: ether('3')}, //UNI
      {address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', denorm: ether('2.75')}, // AAVE
      {address: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', denorm: ether('2.5')}, // SNX
      {address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', denorm: ether('2.5')}, // MKR
      {address: '0x3155ba85d5f96b2d030a4966af206230e46849cb', denorm: ether('2.5')}, // RUNE
      {address: '0xd2877702675e6ceb975b4a1dff9fb7baf4c91ea9', denorm: ether('1.25')}, // LUNA
      {address: '0xc00e94cb662c3520282e6f5717214004a7f26888', denorm: ether('1.25')}, // COMP
      {address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', denorm: ether('1.25')}, // SUSHI
      {address: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', denorm: ether('1.25')}, // YFI
      {address: '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c', denorm: ether('1')}, // BNT
      {address: '0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828', denorm: ether('1')}, // UMA
      {address: '0xe41d2489571d322189246dafa5ebde1f4699f498', denorm: ether('1')}, // ZRX
      {address: '0xD533a949740bb3306d119CC777fa900bA034cd52', denorm: ether('0.625')}, // CRV
      {address: '0x111111111117dc0aa78b770fa6a738034120c302', denorm: ether('0.625')}, // 1ICNH
      {address: '0x408e41876cccdc0f92210600ef50372656052a38', denorm: ether('0.625')}, // REN
      {address: '0xba100000625a3754423978a60c9317c58a424e3d', denorm: ether('0.5')}, // BAL
      {address: '0xa1faa113cbe53436df28ff0aee54275c13b40975', denorm: ether('0.5')}, // ALPHA
      {address: '0xdd974d5c2e2928dea5f71b9825b8b646686bd200', denorm: ether('0.5')}, // KNC
      {address: '0x2ba592F78dB6436527729929AAf6c908497cB200', denorm: ether('0.25')}, // CREAM
      {address: '0x0391D2021f89DC339F60Fff84546EA23E337750f', denorm: ether('0.125')}, // BOND
    ],
    swapFee: 0.002,
    communitySwapFee: 0.001,
    communityJoinFee: 0.001,
    communityExitFee: 0.001,
    communityFeeReceiver: '0xD132973EaEbBd6d7ca7b88e9170f2CCA058de430',
  };

  if (network.name === 'mainnetfork') {
    const uniswapRouter = await UniswapV2Router02.at('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
    await pIteration.forEachSeries(poolConfig.tokens, (t) => {
      const ethToSend = mulScalarBN(divScalarBN(t.denorm, ether('25')), ether('1'));
      console.log('t.address', t.address, 'ethToSend', ethToSend);
      return uniswapRouter.swapExactETHForTokens('1', [wethAddress, t.address], deployer, new Date().getTime(), {
        value: ethToSend,
      });
    });

    const originalDeployer = '0x29bff390fc12c900aaf0f2e51c06675df691337a';
    await impersonateAccount(ethers, originalDeployer);
    await bFactory.setProxySettings(await PowerIndexPool.new().then(p => p.address), proxyAdminAddr, { from: originalDeployer });
  }

  let poolAddress;
  const balances = [];
  await pIteration.forEachSeries(poolConfig.tokens, async (t, index) => {
    const token = await MockERC20.at(t.address);
    balances[index] = (await callContract(token, 'balanceOf', [deployer])).toString(10);
    console.log('approve', token.address, balances[index]);
    await token.approve(bActions.address, balances[index], sendOptions);
  });

  const start = Math.round(new Date().getTime() / 1000) + 60 * 10;

  let res = await bActions.create(
    bFactory.address,
    poolConfig.name,
    poolConfig.symbol,
    {
      minWeightPerSecond: ether('0'),
      maxWeightPerSecond: ether('1'),
      swapFee: ether(poolConfig.swapFee),
      communitySwapFee: ether(poolConfig.communitySwapFee),
      communityJoinFee: ether(poolConfig.communityJoinFee),
      communityExitFee: ether(poolConfig.communityExitFee),
      communityFeeReceiver: poolConfig.communityFeeReceiver,
      finalize: true,
    },
    poolConfig.tokens.map((token, index) => ({
      token: token.address,
      balance: balances[index],
      targetDenorm: token.denorm,
      fromTimestamp: start,
      targetTimestamp: start + 60
    })),
    sendOptions,
  );
  console.log('bActions.create.gasUsed', res.receipt.gasUsed);
  const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
  const pool = await PowerIndexPool.at(logNewPool.args.pool);
  console.log('pool.address', pool.address);

  await pool.setController(admin);
  poolAddress = pool.address;

  // await pvpV1.transferOwnership(admin);
  // await poolRestrictions.transferOwnership(admin);
  if (network.name !== 'mainnetfork') {
    return;
  }
  const erc20PiptSwap = await Erc20PiptSwap.new(
    wethAddress,
    cvpAddress,
    poolAddress,
    zeroAddress,
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
    '0xc944e90c64b2c07662a292be6244bdf05cda44a7', //GRT
  ];
  await erc20PiptSwap.fetchUnswapPairsFromFactory(
    uniswapFactoryAddress,
    (await callContract(pool, 'getCurrentTokens')).concat(swapCoins),
    sendOptions
  );

  await erc20PiptSwap.transferOwnership(admin, sendOptions);

  res = await erc20PiptSwap.swapEthToPipt(ether('0.2'), {
    value: ether('1')
  });

  console.log('swapEthToPipt.gasUsed', res.receipt.gasUsed);

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});
