require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-yearn-router', 'Deploy Yearn Router')
  .setAction(async (__, {ethers, network}) => {
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const PowerIndexWrapper = await artifacts.require('PowerIndexWrapper');
    const WrappedPiErc20Factory = await artifacts.require('WrappedPiErc20Factory');
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const PowerIndexRouterFactory = await artifacts.require('YearnPowerIndexRouterFactory');
    const MockERC20 = await artifacts.require('MockERC20');

    const {impersonateAccount, callContract, increaseTime, forkReplacePoolTokenWithNewPiToken} = require('../test/helpers');
    const {buildYearnRouterArgs} = require('../test/helpers/builders');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();

    const sendOptions = {from: deployer};

    const yfiAddr = '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e';
    const yCrvAddr = '0xdf5e0e81dff6faf3a7e52ba697820c5e32d806a8';
    const votingAddr = '0xBa37B002AbaFDd8E89a1995dA52740bbC013D992';
    const stakingAddr = votingAddr;
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

    if (network.name !== 'mainnetfork') {
      return;
    }
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
        pvp: '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
        pvpFee: ether(0.003),
        rewardPools: ['0x26607ac599266b21d13c7acf7942c7701a8b699c', '0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d'],
      }, {
        YCRV: yCrvAddr,
        USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        YFI: yfiAddr,
        uniswapRouter: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        curveYDeposit: '0xbbc81d23ea2c3ec7e56d39296f0cbb648873a5d3',
        usdcYfiSwapPath: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', yfiAddr],
      }),
      admin
    );
    const yCrv = await MockERC20.at(yCrvAddr);

    console.log('yfi balance after', await callContract(token, 'balanceOf', [pool.address]));
    console.log('yfi wrapper balance after', await callContract(token, 'balanceOf', [wrappedToken.address]));
    console.log('wrapped balance', await callContract(wrappedToken, 'balanceOf', [pool.address]));

    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 80%', await callContract(token, 'balanceOf', [wrappedToken.address]));

    // await router.setReserveConfig(ether(0.2), '3600', {from: admin});
    await increaseTime(60 * 60 * 24 * 60);
    await wrappedToken.pokeRouter();
    // console.log('wrapped balance ratio 20%', await callContract(token, 'balanceOf', [wrappedToken.address]));

    const YearnGovernanceInterface = await artifacts.require('YearnGovernanceInterface');
    const governance = await YearnGovernanceInterface.at(votingAddr);
    console.log('staker.earned(wrappedToken.address)', await callContract(governance, 'earned', [wrappedToken.address]));

    console.log('balance of router before', await callContract(yCrv, 'balanceOf', [router.address]));
    await router.claimRewards();
    console.log('staker.earned(wrappedToken.address)', await callContract(governance, 'earned', [wrappedToken.address]));
    console.log('wrapped balance before', await callContract(pool, 'getBalance', [wrappedToken.address]));
    console.log('balance of router after', await callContract(yCrv, 'balanceOf', [router.address]));
    await router.distributeRewards();
    console.log('balance of router after 2', await callContract(yCrv, 'balanceOf', [router.address]));
    console.log('wrapped balance after', await callContract(pool, 'getBalance', [wrappedToken.address]));

    function ether(amount) {
      return toWei(amount.toString(), 'ether');
    }
  });

