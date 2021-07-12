require('@nomiclabs/hardhat-truffle5');

const pIteration = require('p-iteration');

task('deploy-xcvp', 'xCVP').setAction(async (__, {ethers, network}) => {
  const {deployProxied, ether, fromEther, gwei, impersonateAccount, forkContractUpgrade, increaseTime} = require('../test/helpers');
  const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
  const xCVP = artifacts.require('xCVP');
  const CVPMaker = artifacts.require('CVPMaker');
  const CVPMakerStrategy4 = artifacts.require('CVPMakerStrategy4');
  const PowerIndexPool = artifacts.require('PowerIndexPool');
  const IERC20 = artifacts.require('BToken');

  const { web3 } = PowerIndexPoolController;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const sendOptions = { from: deployer };

  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const admin = '0xb258302c3f209491d604165549079680708581cc';
  const proxyAdminAddr = '0x7696f9208f9e195ba31e6f4B2D07B6462C8C42bb';
  const piptAddress = '0x26607ac599266b21d13c7acf7942c7701a8b699c';
  const yetiAddress = '0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d';
  const assyAddress = '0xfa2562da1bba7b954f26c74725df51fb62646313';
  const assyWrapperAddress = '0x43fa8ef8e334720b80367cf94e438cf90c562abe';
  const ylaAddress = '0x9ba60ba98413a60db4c651d4afe5c937bbd8044b';
  const cvpAddress = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
  const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const sushiAddress = '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2';
  const aaveAddress = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';
  const yfiAddress = '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e';
  const snxAddress = '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f';
  const piSushiAddress = '0xf3505383b740af8c241f1cf6659619a9c38d0281';
  const uniswapRouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
  const sushiRouterAddress = '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f';
  const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';
  const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const vaultPoolSwapAddress = '0x482308830F8945dC360023FaF12c9615509AE51f';

  const xcvp = await xCVP.new(cvpAddress, sendOptions);
  const cvpMaker = await deployProxied(
    CVPMaker,
    [cvpAddress, xcvp.address, wethAddress, uniswapRouterAddress],
    [powerPokeAddress, zeroAddress, ether(10)],
    {
      proxyAdmin: proxyAdminAddr,
      implementation: ''
    }
  );

  await cvpMaker.setCustomPath(sushiAddress, sushiRouterAddress, [sushiAddress, wethAddress], sendOptions);

  const vaultStrategy = await CVPMakerStrategy4.new(usdcAddress, vaultPoolSwapAddress, ether('1.05'), sendOptions);
  const ylaPool = await PowerIndexPool.at(ylaAddress);
  // await cvpMaker.setCustomStrategy2Config(ylaAddress, zeroAddress, sendOptions);
  await pIteration.forEachSeries(await callContract(ylaPool, 'getCurrentTokens'), async token => {
    return cvpMaker.setExternalStrategy(token, vaultStrategy.address, '0x', sendOptions);
  });

  const assyPool = await PowerIndexPool.at(assyAddress);
  await cvpMaker.setCustomStrategy(assyAddress, '2', sendOptions);
  await cvpMaker.setCustomStrategy2Config(assyAddress, assyWrapperAddress, sendOptions);
  await cvpMaker.syncStrategy2Tokens(assyAddress, sendOptions);
  await pIteration.forEachSeries(await callContract(assyPool, 'getCurrentTokens'), async token => {
    await cvpMaker.setCustomStrategy(token, '3', sendOptions);
    if (token.toLowerCase() === piSushiAddress.toLowerCase()) {
      return cvpMaker.setCustomStrategy3Config(token, yetiAddress, zeroAddress, sushiAddress, sendOptions);
    } else if(token.toLowerCase() === yfiAddress.toLowerCase()) {
      return cvpMaker.setCustomStrategy3Config(token, yetiAddress, zeroAddress, zeroAddress, sendOptions);
    } else if(token.toLowerCase() === snxAddress.toLowerCase() || token.toLowerCase() === aaveAddress.toLowerCase()) {
      return cvpMaker.setCustomStrategy3Config(token, piptAddress, zeroAddress, zeroAddress, sendOptions);
    }
  });

  const yetiPool = await PowerIndexPool.at(yetiAddress);
  await cvpMaker.setCustomStrategy(yetiAddress, '1', sendOptions);
  await pIteration.forEachSeries(await callContract(yetiPool, 'getCurrentTokens'), async token => {
    if ((await callContract(cvpMaker, 'customStrategies', [token])).toString() !== '0') {
      return;
    }
    await cvpMaker.setCustomStrategy(token, '3', sendOptions);
    return cvpMaker.setCustomStrategy3Config(token, yetiAddress, zeroAddress, zeroAddress, sendOptions);
  });

  const piptPool = await PowerIndexPool.at(piptAddress);
  await cvpMaker.setCustomStrategy(piptAddress, '1', sendOptions);
  await pIteration.forEachSeries(await callContract(piptPool, 'getCurrentTokens'), async token => {
    if ((await callContract(cvpMaker, 'customStrategies', [token])).toString() !== '0') {
      return;
    }
    await cvpMaker.setCustomStrategy(token, '3', sendOptions);
    return cvpMaker.setCustomStrategy3Config(token, piptAddress, zeroAddress, zeroAddress, sendOptions);
  });

  if (network.name !== 'mainnetfork') {
    return;
  }
  await forkContractUpgrade(ethers, admin, proxyAdminAddr, assyAddress, await PowerIndexPool.new().then(p => p.address))

  const PowerPoke = await artifacts.require('PowerPoke');
  const PermanentVotingPowerV1 = artifacts.require('PermanentVotingPowerV1');
  const pvpAddress = '0xD132973EaEbBd6d7ca7b88e9170f2CCA058de430';
  const pvp = await PermanentVotingPowerV1.at(pvpAddress);

  const cvp = await IERC20.at(cvpAddress);

  await pvp.setFeeManager(admin, {from: admin});
  await pvp.withdraw([
    assyAddress,
    cvpAddress,
    yfiAddress,
    piSushiAddress,
    piptAddress,
    yetiAddress,
    aaveAddress,
  ], [
    await callContract(assyPool, 'balanceOf', [pvp.address]),
    await callContract(cvp, 'balanceOf', [pvp.address]),
    await callContract(await IERC20.at(yfiAddress), 'balanceOf', [pvp.address]),
    await callContract(await IERC20.at(piSushiAddress), 'balanceOf', [pvp.address]),
    await callContract(piptPool, 'balanceOf', [pvp.address]),
    await callContract(yetiPool, 'balanceOf', [pvp.address]),
    await callContract(await IERC20.at(aaveAddress), 'balanceOf', [pvp.address]),
  ], cvpMaker.address, {from: admin});

  console.log('cvp balance before', fromEther(await callContract(cvp, 'balanceOf', [cvpMaker.address])))
  console.log('assy balance before', fromEther(await callContract(assyPool, 'balanceOf', [cvpMaker.address])))
  console.log('yfi balance before', fromEther(await callContract(await IERC20.at(yfiAddress), 'balanceOf', [cvpMaker.address])))
  console.log('piSushiAddress balance before', fromEther(await callContract(await IERC20.at(piSushiAddress), 'balanceOf', [cvpMaker.address])))
  console.log('sushi balance before', fromEther(await callContract(await IERC20.at(sushiAddress), 'balanceOf', [cvpMaker.address])))
  console.log('pipt balance before', fromEther(await callContract(piptPool, 'balanceOf', [cvpMaker.address])))
  console.log('yeti balance before', fromEther(await callContract(yetiPool, 'balanceOf', [cvpMaker.address])))
  console.log('aave balance before', fromEther(await callContract(await IERC20.at(aaveAddress), 'balanceOf', [cvpMaker.address])))

  const BONUS_NUMERATOR = '7610350076';
  const BONUS_DENUMERATOR = '10000000000000000';
  const MIN_REPORT_INTERVAL = 60 * 60 * 24 * 14;
  const MAX_REPORT_INTERVAL = MIN_REPORT_INTERVAL + 60 * 60;
  const MAX_GAS_PRICE = gwei(500);
  const PER_GAS = '10000';
  const MIN_SLASHING_DEPOSIT = ether(40);

  const powerPoke = await PowerPoke.at(powerPokeAddress);
  await powerPoke.addClient(cvpMaker.address, admin, true, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, {from: admin});
  await powerPoke.setMinimalDeposit(cvpMaker.address, MIN_SLASHING_DEPOSIT, {from: admin});
  await powerPoke.setBonusPlan(cvpMaker.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {from: admin});
  await powerPoke.setFixedCompensations(cvpMaker.address, 200000, 60000, {from: admin});

  await cvp.approve(powerPoke.address, ether(10000), {from: admin});
  await powerPoke.addCredit(cvpMaker.address, ether(10000), {from: admin});

  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
    {to: pokerReporter, compensateInETH: true},
  );
  await impersonateAccount(ethers, pokerReporter);

  await cvpMaker.swapFromReporter('1', assyAddress, powerPokeOpts, {from: pokerReporter});
  console.log('cvp balance 1', fromEther(await callContract(cvp, 'balanceOf', [xcvp.address])));

  await increaseTime(MAX_REPORT_INTERVAL);

  await cvpMaker.swapFromReporter('1', cvpAddress, powerPokeOpts, {from: pokerReporter});
  console.log('cvp balance 2', fromEther(await callContract(cvp, 'balanceOf', [xcvp.address])));

  await increaseTime(MAX_REPORT_INTERVAL);

  await cvpMaker.swapFromReporter('1', yfiAddress, powerPokeOpts, {from: pokerReporter});
  console.log('cvp balance 3', fromEther(await callContract(cvp, 'balanceOf', [xcvp.address])));

  await increaseTime(MAX_REPORT_INTERVAL);

  await cvpMaker.swapFromReporter('1', piSushiAddress, powerPokeOpts, {from: pokerReporter});
  console.log('cvp balance 4', fromEther(await callContract(cvp, 'balanceOf', [xcvp.address])));

  await increaseTime(MAX_REPORT_INTERVAL);

  await cvpMaker.swapFromReporter('1', piptAddress, powerPokeOpts, {from: pokerReporter});
  console.log('cvp balance 5', fromEther(await callContract(cvp, 'balanceOf', [xcvp.address])));

  await increaseTime(MAX_REPORT_INTERVAL);

  await cvpMaker.swapFromReporter('1', yetiAddress, powerPokeOpts, {from: pokerReporter});
  console.log('cvp balance 6', fromEther(await callContract(cvp, 'balanceOf', [xcvp.address])));

  await increaseTime(MAX_REPORT_INTERVAL);

  await cvpMaker.swapFromReporter('1', aaveAddress, powerPokeOpts, {from: pokerReporter});
  console.log('cvp balance 7', fromEther(await callContract(cvp, 'balanceOf', [xcvp.address])));

  console.log('assy balance after', fromEther(await callContract(assyPool, 'balanceOf', [cvpMaker.address])))
  console.log('yfi balance after', fromEther(await callContract(await IERC20.at(yfiAddress), 'balanceOf', [cvpMaker.address])))
  console.log('cvp balance after', fromEther(await callContract(cvp, 'balanceOf', [cvpMaker.address])))
  console.log('piSushiAddress balance after', fromEther(await callContract(await IERC20.at(piSushiAddress), 'balanceOf', [cvpMaker.address])))
  console.log('sushi balance after', fromEther(await callContract(await IERC20.at(sushiAddress), 'balanceOf', [cvpMaker.address])))
  console.log('pipt balance after', fromEther(await callContract(piptPool, 'balanceOf', [cvpMaker.address])))
  console.log('yeti balance after', fromEther(await callContract(yetiPool, 'balanceOf', [cvpMaker.address])))
  console.log('aave balance after', fromEther(await callContract(await IERC20.at(aaveAddress), 'balanceOf', [cvpMaker.address])))
});

function callContract(contract, method, args = []) {
  // console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
