require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

const pIteration = require('p-iteration');

task('deploy-yearn-router', 'Deploy Yearn Router')
  .setAction(async (__, {ethers}) => {
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const PowerIndexWrapper = await artifacts.require('PowerIndexWrapper');
    const WrappedPiErc20Factory = await artifacts.require('WrappedPiErc20Factory');
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const PowerIndexRouterFactory = await artifacts.require('YearnPowerIndexRouterFactory');
    const PowerIndexRouter = await artifacts.require('YearnPowerIndexRouter');

    const {impersonateAccount, callContract, increaseTime, forkReplacePoolTokenWithNewPiToken} = require('../test/helpers');
    const {buildBasicRouterArgs, buildYearnRouterArgs} = require('../test/helpers/builders');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();

    const sendOptions = {from: deployer};

    const yfiAddr = '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e';
    const votingAddr = '0xBa37B002AbaFDd8E89a1995dA52740bbC013D992';
    const stakingAddr = '0xBa37B002AbaFDd8E89a1995dA52740bbC013D992';
    const admin = '0xb258302c3f209491d604165549079680708581cc';
    const poolAddress = '0x26607ac599266b21d13c7acf7942c7701a8b699c';
    const pool = await PowerIndexPool.at(poolAddress);
    const poolRestrictionsAddress = await callContract(pool, 'getRestrictions');

    console.log('WrappedPiErc20Factory.new')
    const wrapperFactory = await WrappedPiErc20Factory.new(sendOptions);
    console.log('PowerIndexWrapper.new')
    const poolWrapper = await PowerIndexWrapper.new(poolAddress, sendOptions);
    console.log('PowerIndexPoolController.new')
    const controller = await PowerIndexPoolController.new(
      poolAddress,
      poolWrapper.address,
      wrapperFactory.address,
      sendOptions
    )
    console.log('poolWrapper.setController')
    await poolWrapper.setController(controller.address, sendOptions);
    console.log('PowerIndexRouterFactory.new')
    const routerFactory = await PowerIndexRouterFactory.new();

    await controller.transferOwnership(admin);

    // const networkId = await web3.eth.net.getId();
    // if (networkId === 1) {
    //   return;
    // }
    await impersonateAccount(ethers, admin);

    const {token, wrappedToken, router} = await forkReplacePoolTokenWithNewPiToken(
      artifacts,
      ethers,
      controller,
      yfiAddr,
      routerFactory.address,
      buildYearnRouterArgs(web3, {
        poolRestrictions: poolRestrictionsAddress,
        voting: votingAddr,
        staking: stakingAddr,
        reserveRatio: ether(0.8).toString(),
        rebalancingInterval: '3600',
      }, {
        YCRV: '0xdF5e0e81Dff6FAF3A7e52BA697820c5e32D806A8',
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        YFI: yfiAddr,
        uniswapRouter: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        curveYDeposit: '0xbbc81d23ea2c3ec7e56d39296f0cbb648873a5d3',
        pvp: '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
        pvpFee: '0',
        rewardPools: ['0x26607ac599266b21d13c7acf7942c7701a8b699c', '0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d'],
        usdcYfiSwapPath: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', yfiAddr],
      }),
      admin
    );

    console.log('yfi balance after', await callContract(token, 'balanceOf', [pool.address]));
    return;
    console.log('yfi wrapper balance after', await callContract(token, 'balanceOf', [wrappedToken.address]));
    console.log('wrapped balance', await callContract(wrappedToken, 'balanceOf', [pool.address]));

    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 100%', await callContract(token, 'balanceOf', [wrappedToken.address]));

    await router.setReserveRatio(ether(0.2), {from: admin});
    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 20%', await callContract(token, 'balanceOf', [wrappedToken.address]));

    await increaseTime(ethers, 60 * 60 * 24);
    await wrappedToken.pokeRouter();

    // const staker = await IStakedAave.at(stakingAddr);
    // console.log('staker.balanceOf(wrappedToken.address)', await callContract(staker, 'balanceOf', [wrappedToken.address]));
    // console.log('getUserAssetData', await callContract(staker, 'getUserAssetData', [wrappedToken.address, yfiAddr]));
    // console.log('getTotalRewardsBalance', await callContract(staker, 'getTotalRewardsBalance', [wrappedToken.address]));
    // console.log('stakerRewardsToClaim', await callContract(staker, 'stakerRewardsToClaim', [wrappedToken.address]));

    function ether(amount) {
      return toWei(amount.toString(), 'ether');
    }
  });

