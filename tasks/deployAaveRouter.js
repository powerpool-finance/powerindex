require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

const pIteration = require('p-iteration');

task('deploy-aave-router', 'Deploy AAVE Router')
  .setAction(async (__, {ethers}) => {
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const PowerIndexWrapper = await artifacts.require('PowerIndexWrapper');
    const WrappedPiErc20Factory = await artifacts.require('WrappedPiErc20Factory');
    const WrappedPiErc20 = await artifacts.require('WrappedPiErc20');
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const AavePowerIndexRouterFactory = await artifacts.require('AavePowerIndexRouterFactory');
    const AavePowerIndexRouter = await artifacts.require('AavePowerIndexRouter');

    const {impersonateAccount, deployAndSaveArgs, increaseTime} = require('../test/helpers');
    const {buildBasicRouterArgs} = require('../test/helpers/builders');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();
    console.log('deployer', deployer);
    const sendOptions = {from: deployer};

    const aave = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
    const aaveVoting = '0xb7e383ef9b1e9189fc0f71fb30af8aa14377429e';
    const aaveStaking = '0x4da27a545c0c5B758a6BA100e3a049001de870f5';
    const admin = '0xb258302c3f209491d604165549079680708581cc';
    const poolAddress = '0x26607ac599266b21d13c7acf7942c7701a8b699c';
    const poolRestrictionsAddress = '0x3885c4e1107b445dd370d09008d90b5153132fff';
    const pool = await PowerIndexPool.at(poolAddress);

    const wrapperFactory = await WrappedPiErc20Factory.new(sendOptions);
    const poolWrapper = await PowerIndexWrapper.new(poolAddress, sendOptions);
    const controller = await PowerIndexPoolController.new(
      poolAddress,
      poolWrapper.address,
      wrapperFactory.address,
      sendOptions
    )
    await poolWrapper.setController(controller.address, sendOptions);
    const aaveRouterFactory = await AavePowerIndexRouterFactory.new();

    await controller.transferOwnership(admin);

    // const networkId = await web3.eth.net.getId();
    // if (networkId === 1) {
    //   return;
    // }
    const MockERC20 = await artifacts.require('MockERC20');
    const IStakedAave = await artifacts.require('IStakedAave');
    const aaveToken = await MockERC20.at(aave);
    console.log('aave balance before', await callContract(aaveToken, 'balanceOf', [pool.address]));
    await impersonateAccount(ethers, admin);

    await pool.setController(controller.address, {from: admin});

    const res = await controller.replacePoolTokenWithNewPiToken(
      aave,
      aaveRouterFactory.address,
      buildBasicRouterArgs(web3, {
        poolRestrictions: poolRestrictionsAddress,
        voting: aaveVoting,
        staking: aaveStaking,
        reserveRatio: ether(0.8),
        rebalancingInterval: '3600',
      }),
      'Wrapped AAVE',
      'WAAVE',
      {from: admin}
    );

    const wrappedTokenAddress = res.logs.filter(l => l.event === 'ReplacePoolTokenWithWrapped')[0].args.wrappedToken;
    const wrappedToken = await WrappedPiErc20.at(wrappedTokenAddress);
    const router = await AavePowerIndexRouter.at(await callContract(wrappedToken, 'router', []));

    await increaseTime(ethers, 60);

    await controller.finishReplace();

    console.log('aave balance after', await callContract(aaveToken, 'balanceOf', [pool.address]));
    console.log('aave wrapper balance after', await callContract(aaveToken, 'balanceOf', [wrappedTokenAddress]));
    console.log('wrapped balance', await callContract(wrappedToken, 'balanceOf', [pool.address]));

    console.log('await callContract(pool, "isBound", [aave])', await callContract(pool, "isBound", [aave]));
    console.log('await callContract(pool, "isBound", [wrappedTokenAddress])', await callContract(pool, "isBound", [wrappedTokenAddress]));

    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 100%', await callContract(aaveToken, 'balanceOf', [wrappedToken.address]));

    await router.setReserveRatio(ether(0.2), {from: admin});
    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 20%', await callContract(aaveToken, 'balanceOf', [wrappedToken.address]));

    await increaseTime(ethers, 60 * 60 * 24);
    await wrappedToken.pokeRouter();

    const staker = await IStakedAave.at(aaveStaking);
    console.log('staker.balanceOf(wrappedToken.address)', await callContract(staker, 'balanceOf', [wrappedToken.address]));
    console.log('getUserAssetData', await callContract(staker, 'getUserAssetData', [wrappedToken.address, aave]));
    console.log('getTotalRewardsBalance', await callContract(staker, 'getTotalRewardsBalance', [wrappedToken.address]));
    console.log('stakerRewardsToClaim', await callContract(staker, 'stakerRewardsToClaim', [wrappedToken.address]));

    function ether(amount) {
      return toWei(amount.toString(), 'ether');
    }
  });

function callContract(contract, method, args = []) {
  console.log(method, args);
  return contract.contract.methods[method].apply(contract.contract, args).call();
}
