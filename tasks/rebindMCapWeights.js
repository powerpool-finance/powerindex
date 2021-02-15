require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');
const axios = require('axios');
const _ = require('lodash');

task('rebind-mcap-weights', 'Rebind MCap weights').setAction(async (__, {ethers, network}) => {
  const {forkContractUpgrade} = require('../test/helpers');
  const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
  const PowerIndexPool = artifacts.require('PowerIndexPool');
  const MCapWeightStrategyRebinder = artifacts.require('MCapWeightStrategyRebinder');
  const MockERC20 = await artifacts.require('MockERC20');

  const { web3 } = PowerIndexPoolController;
  const { toWei, fromWei, toBN } = web3.utils;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const admin = '0xb258302c3f209491d604165549079680708581cc';
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const oracleAddress = '0x50f8D7f4db16AA926497993F020364f739EDb988';
  const oneInchAddress = '0x111111125434b319222CdBf8C261674aDB56F3ae';
  const poolAddress = '0xfa2562da1bba7b954f26c74725df51fb62646313';
  const fetchOneInchApiSeller = '0x906B629c11Afa6A328899e8F3a113e64eA87B7eD';

  const rebinder = await MCapWeightStrategyRebinder.new(oracleAddress, oneInchAddress, sendOptions);
  console.log('rebinder', rebinder.address);

  const excludeBalances = [
    {token: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', excludeTokenBalances: ['0x25F2226B597E8F9514B3F68F00f494cF4f286491', '0x317625234562B1526Ea2FaC4030Ea499C5291de4']}, // AAVE
    {token: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e', excludeTokenBalances: ['0xFEB4acf3df3cDEA7399794D0869ef76A6EfAff52']}, // YFI
    {token: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', excludeTokenBalances: ['0x971e78e0c92392a4e39099835cf7e6ab535b2227', '0xda4ef8520b1a57d7d63f1e249606d1a459698876']}, // SNX
  ];

  await rebinder.setExcludeTokenBalancesList(excludeBalances);

  await rebinder.transferOwnership(admin);

  if (network.name !== 'mainnetfork') {
    return;
  }
  await web3.eth.sendTransaction({
    from: deployer,
    to: admin,
    value: ether(1)
  })
  const InstantUniswapPrice = artifacts.require('InstantUniswapPrice');
  await forkContractUpgrade(ethers, admin, proxyAdminAddr, poolAddress, (await PowerIndexPool.new()).address);

  const pool = await PowerIndexPool.at(poolAddress);
  const tokens = await callContract(pool, 'getCurrentTokens');


  const rebindConfigs = await callContract(rebinder, 'getRebindConfigs', [poolAddress, tokens, '2']).then(configs => configs.map(c => _.pick(c, ['token', 'newWeight', 'oldBalance', 'newBalance'])));

  const instantPriceAddress = '0x1af9747615abce1db5c482e865699ba5a2d9c804';
  const instantPrice = await InstantUniswapPrice.at(instantPriceAddress);
  const yfi = '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e';

  let needToBuyUsdSum = '0';
  const usdSumByToken = {};
  await pIteration.mapSeries(rebindConfigs, async (c) => {
    if (isBnGreater(c.newBalance, c.oldBalance)) {
      usdSumByToken[c.token] = await instantPrice.usdcTokensSum([c.token], [subBN(c.newBalance, c.oldBalance)]);
      needToBuyUsdSum = addBN(needToBuyUsdSum, usdSumByToken[c.token]);
    }
  })
  const subShare = 0.05;
  console.log('subShare', subShare);
  rebindConfigs[0].newBalance = subBN(rebindConfigs[0].newBalance, mulScalarBN(subBN(rebindConfigs[0].oldBalance, rebindConfigs[0].newBalance), ether(subShare)));
  const yfiBalanceToSwap = subBN(rebindConfigs[0].oldBalance, rebindConfigs[0].newBalance);
  console.log('yfiBalanceToSwap', fromEther(yfiBalanceToSwap))

  const oneInchApi = 'https://api.1inch.exchange/v2.0/swap';
  const yfiSwaps = [];

  const ops = await pIteration.mapSeries(rebindConfigs, async c => {
    if (isBnGreater(c.oldBalance, c.newBalance)) {
      return {
        ...c,
        opApproveAmount: '0',
        opToken: zeroAddress,
        opData: '0x',
        opAfter: false
      }
    } else {
      const tokenShare = divScalarBN(usdSumByToken[c.token], needToBuyUsdSum);
      const yfiAmountToSwap = mulScalarBN(yfiBalanceToSwap, tokenShare);

      yfiSwaps.push({
        amount: yfiAmountToSwap,
        token: c.token,
        config: c
      });
      return null;
    }
  }).then(res => res.filter(r => r));

  console.log('\nbefore:');
  await logPrices();
  await pool.setController(rebinder.address, {from: admin});

  await rebinder.runRebind(poolAddress, admin, ops, {from: admin, gas: 12000000});

  await pIteration.forEachSeries(yfiSwaps, async (s) => {
    const {data} = await axios.get(oneInchApi, {
      params: {
        fromTokenAddress: yfi,
        toTokenAddress: s.token,
        amount: s.amount,
        fromAddress: fetchOneInchApiSeller,
        destReceiver: rebinder.address,
        slippage: 5
      }
    })

    const operation = {
      ...s.config,
      opApproveAmount: s.amount,
      opToken: yfi,
      opData: data.tx.data.toLowerCase().replace(
        fetchOneInchApiSeller.toLowerCase().replace('0x', ''),
        rebinder.address.toLowerCase().replace('0x', '')
      ),
      opAfter: false
    }

    await rebinder.runRebind(poolAddress, admin, [operation], {from: admin, gas: 12000000});
  })

  console.log('\nafter:')
  await logPrices();

  function ether(amount) {
    return toWei(amount.toString(), 'ether');
  }
  function fromEther(amount) {
    return fromWei(amount.toString(), 'ether');
  }
  function isBnGreater(bn1, bn2) {
    return toBN(bn1.toString(10)).gt(toBN(bn2.toString(10)));
  }
  function subBN(bn1, bn2) {
    return toBN(bn1.toString(10)).sub(toBN(bn2.toString(10))).toString(10);
  }
  function addBN(bn1, bn2) {
    return toBN(bn1.toString(10)).add(toBN(bn2.toString(10))).toString(10);
  }
  function mulBN(bn1, bn2) {
    return toBN(bn1.toString(10)).mul(toBN(bn2.toString(10))).toString(10);
  }
  function divBN(bn1, bn2) {
    return toBN(bn1.toString(10)).div(toBN(bn2.toString(10))).toString(10);
  }
  function mulScalarBN(bn1, bn2) {
    return divBN(mulBN(bn1, bn2), toBN(ether(1))).toString(10);
  }
  function divScalarBN(bn1, bn2) {
    return divBN(mulBN(bn1, toBN(ether(1))), bn2).toString(10);
  }
  async function logPrices() {
    const totalDenorm = await callContract(pool, 'getTotalDenormalizedWeight', []);
    const swapFee = await callContract(pool, 'getSwapFee', []);

    await pIteration.forEachSeries(tokens, async (t, i) => {
      const token = await MockERC20.at(t);
      const [balance, denorm, totalSupply] = await Promise.all([
        callContract(pool, 'getBalance', [t]),
        callContract(pool, 'getDenormalizedWeight', [t]),
        callContract(pool, 'totalSupply', [])
      ]);
      console.log(
        await callContract(token, 'symbol'),
        'balance',
        fromEther(balance),
        'denorm',
        fromEther(denorm),
        'weight',
        fromEther(await callContract(pool, 'getNormalizedWeight', [t])),
        'price',
        fromEther(await callContract(pool, 'getSpotPrice', [t, i === 0 ? tokens[tokens.length - 1] : tokens[i - 1]])),
        'exit',
        fromEther(await callContract(pool, 'calcPoolInGivenSingleOut', [balance, denorm, totalSupply, totalDenorm, ether(1), swapFee])),
      );
    });
    console.log('balancerPoolUsdTokensSum', fromEther(await instantPrice.balancerPoolUsdTokensSum(poolAddress)));
  }
});

function callContract(contract, method, args = []) {
  // console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
