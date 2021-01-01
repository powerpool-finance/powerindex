require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

const pIteration = require('p-iteration');

task('deploy-aave-router', 'Deploy AAVE Router')
  .setAction(async (__, {ethers}) => {
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const PowerIndexWrapper = await artifacts.require('PowerIndexWrapper');
    const WrappedPiErc20Factory = await artifacts.require('WrappedPiErc20Factory');
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const PowerIndexRouterFactory = await artifacts.require('AavePowerIndexRouterFactory');
    const PowerIndexRouter = await artifacts.require('AavePowerIndexRouter');

    const {impersonateAccount, callContract, increaseTime, forkReplacePoolTokenWithNewPiToken} = require('../test/helpers');
    const {buildAaveRouterArgs} = require('../test/helpers/builders');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();
    console.log('deployer', deployer);
    const sendOptions = {from: deployer};

    const aave = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
    const votingAddr = '0xb7e383ef9b1e9189fc0f71fb30af8aa14377429e';
    const stakingAddr = '0x4da27a545c0c5B758a6BA100e3a049001de870f5';
    const admin = '0xb258302c3f209491d604165549079680708581cc';
    const poolAddress = '0x26607ac599266b21d13c7acf7942c7701a8b699c';
    const pool = await PowerIndexPool.at(poolAddress);
    const poolRestrictionsAddress = await callContract(pool, 'getRestrictions');

    const wrapperFactory = await WrappedPiErc20Factory.new(sendOptions);
    const poolWrapper = await PowerIndexWrapper.new(poolAddress, sendOptions);
    const controller = await PowerIndexPoolController.new(
      poolAddress,
      poolWrapper.address,
      wrapperFactory.address,
      sendOptions
    )
    await poolWrapper.setController(controller.address, sendOptions);
    const aaveRouterFactory = await PowerIndexRouterFactory.new();

    await controller.transferOwnership(admin);

    // const networkId = await web3.eth.net.getId();
    // if (networkId === 1) {
    //   return;
    // }
    await impersonateAccount(ethers, admin);
    const IStakedAave = await artifacts.require('IStakedAave');

    const {token, wrappedToken, router} = await forkReplacePoolTokenWithNewPiToken(
      artifacts,
      ethers,
      controller,
      aave,
      aaveRouterFactory.address,
      buildAaveRouterArgs(web3, {
        poolRestrictions: poolRestrictionsAddress,
        voting: votingAddr,
        staking: stakingAddr,
        reserveRatio: ether(0.8),
        rebalancingInterval: '3600',
        pvp: '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
        pvpFee: '0',
        rewardPools: ['0x26607ac599266b21d13c7acf7942c7701a8b699c', '0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d'],
      }, {
        AAVE: aave,
      }),
      admin
    );

    console.log('aave balance after', await callContract(token, 'balanceOf', [pool.address]));
    console.log('aave wrapper balance after', await callContract(token, 'balanceOf', [wrappedToken.address]));
    console.log('wrapped balance', await callContract(wrappedToken, 'balanceOf', [pool.address]));

    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 80%', await callContract(token, 'balanceOf', [wrappedToken.address]));

    await router.setReserveConfig(ether(0.2), '3600', {from: admin});
    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 20%', await callContract(token, 'balanceOf', [wrappedToken.address]));

    await increaseTime(60 * 60 * 24);
    await wrappedToken.pokeRouter();

    const staker = await IStakedAave.at(stakingAddr);
    console.log('staker.balanceOf(wrappedToken.address)', await callContract(staker, 'balanceOf', [wrappedToken.address]));
    console.log('getUserAssetData', await callContract(staker, 'getUserAssetData', [wrappedToken.address, aave]));
    console.log('getTotalRewardsBalance', await callContract(staker, 'getTotalRewardsBalance', [wrappedToken.address]));
    console.log('stakerRewardsToClaim', await callContract(staker, 'stakerRewardsToClaim', [wrappedToken.address]));

    function ether(amount) {
      return toWei(amount.toString(), 'ether');
    }
  });

