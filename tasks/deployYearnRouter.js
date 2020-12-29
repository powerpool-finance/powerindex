require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

const pIteration = require('p-iteration');

task('deploy-yearn-router', 'Deploy Yearn Router')
  .setAction(async (__, {ethers}) => {
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const PowerIndexWrapper = await artifacts.require('PowerIndexWrapper');
    const WrappedPiErc20Factory = await artifacts.require('WrappedPiErc20Factory');
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const AavePowerIndexRouterFactory = await artifacts.require('AavePowerIndexRouterFactory');
    const AavePowerIndexRouter = await artifacts.require('AavePowerIndexRouter');

    const {impersonateAccount, callContract, increaseTime, forkReplacePoolTokenWithNewPiToken} = require('../test/helpers');
    const {buildBasicRouterArgs} = require('../test/helpers/builders');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();
    console.log('deployer', deployer);
    const sendOptions = {from: deployer};

    const yfi = '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e';
    const aaveVoting = '0xb7e383ef9b1e9189fc0f71fb30af8aa14377429e';
    const aaveStaking = '0x4da27a545c0c5B758a6BA100e3a049001de870f5';
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
    const aaveRouterFactory = await AavePowerIndexRouterFactory.new();

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
      yfi,
      aaveRouterFactory.address,
      buildBasicRouterArgs(web3, {
        poolRestrictions: poolRestrictionsAddress,
        voting: aaveVoting,
        staking: aaveStaking,
        reserveRatio: ether(0.8),
        rebalancingInterval: '3600',
      }),
      admin
    );

    console.log('yfi balance after', await callContract(token, 'balanceOf', [pool.address]));
    console.log('yfi wrapper balance after', await callContract(token, 'balanceOf', [wrappedToken.address]));
    console.log('wrapped balance', await callContract(wrappedToken, 'balanceOf', [pool.address]));

    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 100%', await callContract(token, 'balanceOf', [wrappedToken.address]));

    await router.setReserveRatio(ether(0.2), {from: admin});
    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 20%', await callContract(token, 'balanceOf', [wrappedToken.address]));

    await increaseTime(ethers, 60 * 60 * 24);
    await wrappedToken.pokeRouter();

    const staker = await IStakedAave.at(aaveStaking);
    console.log('staker.balanceOf(wrappedToken.address)', await callContract(staker, 'balanceOf', [wrappedToken.address]));
    console.log('getUserAssetData', await callContract(staker, 'getUserAssetData', [wrappedToken.address, yfi]));
    console.log('getTotalRewardsBalance', await callContract(staker, 'getTotalRewardsBalance', [wrappedToken.address]));
    console.log('stakerRewardsToClaim', await callContract(staker, 'stakerRewardsToClaim', [wrappedToken.address]));

    function ether(amount) {
      return toWei(amount.toString(), 'ether');
    }
  });

