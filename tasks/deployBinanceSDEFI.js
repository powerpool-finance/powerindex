require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-binance-sdefi', 'Deploy Binance sDEFI').setAction(async (__, {ethers, network}) => {
  const {impersonateAccount, callContract, mulScalarBN, divScalarBN, zeroAddress, fromEther} = require('../test/helpers');

  const PowerIndexPoolFactory = await artifacts.require('PowerIndexPoolFactory');
  const ProxyFactory = await artifacts.require('ProxyFactory');
  const PowerIndexPoolActions = await artifacts.require('PowerIndexPoolActions');
  const PowerIndexPool = await artifacts.require('PowerIndexPool');
  const IERC20 = await artifacts.require('flatten/PowerIndexPool.sol:IERC20');

  const { web3 } = PowerIndexPoolFactory;
  const { toWei } = web3.utils;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const proxyAdminAddr = '0x052751e60ce732975A9E48e023413fb909e53B3D';

  const admin = '0x560640c19649FD87ca3c5bAde137f6f1cCB9F0B0';
  const proxyFactoryAddr = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
  const impl = await PowerIndexPool.at('0xbCDBFAEa7E0809c2Bd7B2A62FE05e9eaa89dFeaa');

  // const bFactory = await PowerIndexPoolFactory.at('0x37c4a7e826a7f6606628eb5180df7be8d6ca4b2c');
  // const bActions = await PowerIndexPoolActions.at('0x0d8879056cc1dfa4998b6f5c75c7ea4d8e939223');
  //
  // const poolConfig = {
  //   name: 'BSC Ecosystem Defi blue chips',
  //   symbol: 'BSCDEFI',
  //   tokens: [
  //     {address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', denorm: ether('10')}, //CAKE
  //     {address: '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63', denorm: ether('3.75')}, // XVS
  //     {address: '0x9C65AB58d8d978DB963e63f2bfB7121627e3a739', denorm: ether('1.75')}, // MDX
  //     {address: '0xA7f552078dcC247C2684336020c03648500C6d9F', denorm: ether('1.5')}, // EPS
  //     {address: '0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F', denorm: ether('1.25')}, // ALPACA
  //     {address: '0xE02dF9e3e622DeBdD69fb838bB799E3F168902c5', denorm: ether('1')}, // BAKE
  //     {address: '0xa184088a740c695e156f91f5cc086a06bb78b827', denorm: ether('1')}, // AUTO
  //     {address: '0xa1faa113cbe53436df28ff0aee54275c13b40975', denorm: ether('1')}, // ALPHA
  //     {address: '0x67ee3cb086f8a16f34bee3ca72fad36f7db929e2', denorm: ether('1')}, // DODO
  //     {address: '0x3910db0600ea925f63c36ddb1351ab6e2c6eb102', denorm: ether('0.75')}, // SPARTA
  //     {address: '0xd4CB328A82bDf5f03eB737f37Fa6B370aef3e888', denorm: ether('0.75')}, // CREAM
  //     {address: '0x762539b45A1dCcE3D36d080F74d1AED37844b878', denorm: ether('0.75')}, // LINA(BSC)
  //     {address: '0x9f589e3eabe42ebc94a44727b3f3531c0c877809', denorm: ether('0.5')}, // TKO
  //   ],
  //   swapFee: 0.002,
  //   communitySwapFee: 0.001,
  //   communityJoinFee: 0.001,
  //   communityExitFee: 0.001,
  //   communityFeeReceiver: '0xe526ac8a98cd588137515f169327c59c19f0baf4',
  // };
  //
  // let poolAddress;
  // const balances = [];
  // let spartaBalance;
  // await pIteration.forEachSeries(poolConfig.tokens, async (t, index) => {
  //   const token = await IERC20.at(t.address);
  //   const allowance = (await callContract(token, 'allowance', [deployer, bActions.address])).toString(10);
  //   balances[index] = (await callContract(token, 'balanceOf', [deployer])).toString(10);
  //   if (t.address === '0x3910db0600ea925f63c36ddb1351ab6e2c6eb102') {
  //     spartaBalance = mulScalarBN(balances[index], ether('0.9972'));
  //   }
  //   console.log('balance', token.address, balances[index]);
  //   if (allowance !== '0') {
  //     return;
  //   }
  //   console.log('approve', token.address, balances[index]);
  //   await token.approve(bActions.address, balances[index], sendOptions);
  // });
  //
  // let start = Math.round(new Date().getTime() / 1000) + 60;
  //
  // let res = await bActions.create(
  //   bFactory.address,
  //   poolConfig.name,
  //   poolConfig.symbol,
  //   {
  //     minWeightPerSecond: ether('0'),
  //     maxWeightPerSecond: ether('1'),
  //     swapFee: ether(poolConfig.swapFee),
  //     communitySwapFee: ether(poolConfig.communitySwapFee),
  //     communityJoinFee: ether(poolConfig.communityJoinFee),
  //     communityExitFee: ether(poolConfig.communityExitFee),
  //     communityFeeReceiver: poolConfig.communityFeeReceiver,
  //     finalize: true,
  //   },
  //   poolConfig.tokens.filter(t => t.address !== '0x3910db0600ea925f63c36ddb1351ab6e2c6eb102' && t.address !== '0xd4CB328A82bDf5f03eB737f37Fa6B370aef3e888').map((token, index) => ({
  //     token: token.address,
  //     balance: balances[index],
  //     targetDenorm: token.denorm,
  //     fromTimestamp: start,
  //     targetTimestamp: start + 60
  //   })),
  //   sendOptions,
  // );
  // console.log('bActions.create.gasUsed', res.receipt.gasUsed);
  // const logNewPool = PowerIndexPoolFactory.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'LOG_NEW_POOL')[0];
  const pool = await PowerIndexPool.at('0x40E46dE174dfB776BB89E04dF1C47d8a66855EB3');
  // const tokens = await callContract(pool, 'getCurrentTokens');
  // for (let i = 0; i < tokens.length; i++) {
  //   const token = await IERC20.at(tokens[i]);
  //   console.log(tokens[i], await callContract(pool, 'symbol'), fromEther(await callContract(pool, 'getNormalizedWeight', [tokens[i]])));
  // }

  const proxyFactory = await ProxyFactory.at(proxyFactoryAddr);
  // console.log(pool.contract.methods.initialize('BSC Ecosystem Defi blue chips', 'BSCDEFI', '0x0d8879056cc1dfa4998b6f5c75c7ea4d8e939223', ether('0'), ether('1')).encodeABI())
  // console.log(proxyFactory.contract.methods.build(
  //   impl.address,
  //   proxyAdminAddr,
  //   pool.contract.methods.initialize('BSC Ecosystem Defi blue chips', 'BSCDEFI', '0x0d8879056cc1dfa4998b6f5c75c7ea4d8e939223', ether('0'), ether('1')).encodeABI()
  // ).encodeABI())
  const iface = new ethers.utils.Interface(['function upgrade(address proxy, address impl)']);
  console.log('estimate', await web3.eth.estimateGas({
    to: proxyAdminAddr,
    data: iface.encodeFunctionData('upgrade', ['0x5ec3adbdae549dce842e24480eb2434769e22b2e', impl.address]),
    from: admin
  }))
  //
  // console.log('pool.address', pool.address);
  //
  // await pool.setSwapsDisabled(true);
  //
  // const sparta = await IERC20.at('0x3910db0600ea925f63c36ddb1351ab6e2c6eb102');
  // await sparta.approve(pool.address, spartaBalance);
  // await pool.bind('0x3910db0600ea925f63c36ddb1351ab6e2c6eb102', spartaBalance, ether('0.75'));

  // const cream = await IERC20.at('0xd4CB328A82bDf5f03eB737f37Fa6B370aef3e888');
  // await cream.approve(pool.address, await callContract(cream, 'balanceOf', [deployer]));
  // await pool.bind(cream.address,  await callContract(cream, 'balanceOf', [deployer]), ether('0.75'));

  // await pool.setController(admin);

  // await pvpV1.transferOwnership(admin);
  // await poolRestrictions.transferOwnership(admin);
  // if (network.name !== 'mainnetfork') {
  //   return;
  // }
  // const erc20PiptSwap = await Erc20PiptSwap.new(
  //   wethAddress,
  //   cvpAddress,
  //   poolAddress,
  //   zeroAddress,
  //   admin,
  //   sendOptions
  // );
  // console.log('erc20PiptSwap', erc20PiptSwap.address);
  //
  // const swapCoins = [
  //   '0xdAC17F958D2ee523a2206206994597C13D831ec7', //USDT
  //   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', //USDC
  //   '0x6B175474E89094C44Da98b954EedeAC495271d0F', //DAI
  //   '0x1494CA1F11D487c2bBe4543E90080AeBa4BA3C2b', //DPI
  //   '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', //WBTC
  //   '0xc944e90c64b2c07662a292be6244bdf05cda44a7', //GRT
  // ];
  // await erc20PiptSwap.fetchUnswapPairsFromFactory(
  //   uniswapFactoryAddress,
  //   (await callContract(pool, 'getCurrentTokens')).concat(swapCoins),
  //   sendOptions
  // );
  //
  // await erc20PiptSwap.transferOwnership(admin, sendOptions);
  //
  // res = await erc20PiptSwap.swapEthToPipt(ether('0.2'), {
  //   value: ether('1')
  // });
  //
  // console.log('swapEthToPipt.gasUsed', res.receipt.gasUsed);

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
});
