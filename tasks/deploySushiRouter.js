require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-sushi-router', 'Deploy SUSHI Router')
  .setAction(async (__, {ethers, network}) => {
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const PowerIndexWrapper = await artifacts.require('PowerIndexWrapper');
    const WrappedPiErc20Factory = await artifacts.require('WrappedPiErc20Factory');
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const PowerIndexRouterFactory = await artifacts.require('SushiPowerIndexRouterFactory');

    const {impersonateAccount, callContract, increaseTime, forkReplacePoolTokenWithNewPiToken, fromEther} = require('../test/helpers');
    const {buildSushiRouterArgs} = require('../test/helpers/builders');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();
    console.log('deployer', deployer);
    const sendOptions = {from: deployer};

    const sushi = '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2';
    const votingAddr = '0x0000000000000000000000000000000000000000';
    const stakingAddr = '0x8798249c2e607446efb7ad49ec89dd1865ff4272';
    const admin = '0xb258302c3f209491d604165549079680708581cc';
    const poolAddress = '0xfa2562da1bba7b954f26c74725df51fb62646313';
    const pool = await PowerIndexPool.at(poolAddress);
    const poolRestrictionsAddress = '0x3885c4e1107b445dd370d09008d90b5153132fff';

    const poolWrapper = await PowerIndexWrapper.new(poolAddress, sendOptions);
    const controller = await PowerIndexPoolController.at('0x99655673c57a29518c60775252716c320a9e7d2f');
    await poolWrapper.setController(controller.address, sendOptions);
    const sushiRouterFactory = await PowerIndexRouterFactory.new();
    const wrapperFactory = await WrappedPiErc20Factory.new(sendOptions);

    if (network.name !== 'mainnetfork') {
      return;
    }
    const sushiHolder = '0xe93381fb4c4f14bda253907b18fad305d799241a';
    await impersonateAccount(ethers, admin);
    await impersonateAccount(ethers, sushiHolder);
    await web3.eth.sendTransaction({
      from: deployer,
      to: admin,
      value: ether(1),
    })
    const IERC20 = await artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');
    const sushiToken = await IERC20.at(sushi);

    await controller.setPoolWrapper(poolWrapper.address, {from: admin});
    await controller.setPiTokenFactory(wrapperFactory.address, {from: admin});

    const {token, wrappedToken, router} = await forkReplacePoolTokenWithNewPiToken(
      artifacts,
      ethers,
      controller,
      sushi,
      sushiRouterFactory.address,
      buildSushiRouterArgs(web3, {
        poolRestrictions: poolRestrictionsAddress,
        voting: votingAddr,
        staking: stakingAddr,
        reserveRatio: ether(0.8),
        rebalancingInterval: '3600',
        pvp: '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
        pvpFee: ether(0.003),
        rewardPools: ['0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d', '0xfa2562da1bba7b954f26c74725df51fb62646313'],
      }, {
        SUSHI: sushi,
      }),
      admin,
      'sushi'
    );

    console.log('aave balance after', await callContract(token, 'balanceOf', [pool.address]));
    console.log('aave wrapper balance after', await callContract(token, 'balanceOf', [wrappedToken.address]));
    console.log('wrapped balance', await callContract(wrappedToken, 'balanceOf', [pool.address]));

    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 80%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

    await router.setReserveConfig(ether(0.2), '3600', {from: admin});
    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 20%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

    await increaseTime(60 * 60 * 24);
    await wrappedToken.pokeRouter();
    console.log('wrapped balance ratio 20%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

    const staker = await IERC20.at(stakingAddr);
    console.log('staker.balanceOf(wrappedToken.address)', fromEther(await callContract(staker, 'balanceOf', [wrappedToken.address])));
    console.log('router.getSushiForXSushi', fromEther(await callContract(router, 'getSushiForXSushi', [await callContract(staker, 'balanceOf', [wrappedToken.address])])));

    await sushiToken.transfer(stakingAddr, ether(10000), {from: sushiHolder});

    console.log('balance of router before', fromEther(await callContract(token, 'balanceOf', [router.address])));
    await router.claimRewards();
    console.log('wrapped balance before', fromEther(await callContract(pool, 'getBalance', [wrappedToken.address])));
    console.log('balance of router after', fromEther(await callContract(token, 'balanceOf', [router.address])));
    await router.distributeRewards();
    console.log('balance of router after 2', fromEther(await callContract(token, 'balanceOf', [router.address])));
    console.log('wrapped balance after', fromEther(await callContract(pool, 'getBalance', [wrappedToken.address])));
    console.log('staker.balanceOf(wrappedToken.address)', fromEther(await callContract(staker, 'balanceOf', [wrappedToken.address])));
    console.log('router.getSushiForXSushi', fromEther(await callContract(router, 'getSushiForXSushi', [await callContract(staker, 'balanceOf', [wrappedToken.address])])));

    function ether(amount) {
      return toWei(amount.toString(), 'ether');
    }
  });

