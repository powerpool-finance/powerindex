require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-sushi-router-for-yeti', 'Deploy SUSHI Router for YETI')
  .setAction(async (__, {ethers, network}) => {
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const PowerIndexWrapper = await artifacts.require('PowerIndexWrapper');
    const WrappedPiErc20Factory = await artifacts.require('WrappedPiErc20Factory');
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const WrappedPiErc20 = await artifacts.require('WrappedPiErc20');
    const PowerIndexRouter = await artifacts.require('SushiPowerIndexRouter');

    const {impersonateAccount, callContract, increaseTime, fromEther} = require('../test/helpers');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();
    console.log('deployer', deployer);
    const sendOptions = {from: deployer};

    const sushi = '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2';
    const weightsStrategyAddr = '0x0000000000000000000000000000000000000000';
    const stakingAddr = '0x8798249c2e607446efb7ad49ec89dd1865ff4272';
    const admin = '0xb258302c3f209491d604165549079680708581cc';
    const poolAddress = '0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d';
    const pool = await PowerIndexPool.at(poolAddress);

    const poolWrapper = await PowerIndexWrapper.new(poolAddress, sendOptions);
    const wrapperFactory = await WrappedPiErc20Factory.new(sendOptions);
    const controller = await PowerIndexPoolController.new(poolAddress, poolWrapper.address, wrapperFactory.address, weightsStrategyAddr, sendOptions);
    await poolWrapper.setController(controller.address, sendOptions);

    await controller.transferOwnership(admin, {from: deployer});

    if (network.name !== 'mainnetfork') {
      return;
    }
    const IERC20 = await artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');

    const sushiHolder = '0xe93381fb4c4f14bda253907b18fad305d799241a';
    const poolHolder = '0x87fc1313880d579039ac48db8b25428ed5f33c4a';
    const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
    const wrappedSushiAddress = '0xac29807CC9A1eCe0D16e56f4eF56B9a7C6159c3b';

    await impersonateAccount(ethers, admin);
    await impersonateAccount(ethers, sushiHolder);
    await impersonateAccount(ethers, pokerReporter);
    await impersonateAccount(ethers, poolHolder);

    const sushiToken = await IERC20.at(sushi);
    const wrappedToken = await WrappedPiErc20.at(wrappedSushiAddress);
    const router = await PowerIndexRouter.at(await callContract(wrappedToken, 'router'))

    const testWallet = ethers.Wallet.createRandom();
    const powerPokeOpts = web3.eth.abi.encodeParameter(
      { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
      {to: testWallet.address, compensateInETH: true},
    );

    const MIN_REPORT_INTERVAL = 60 * 60 * 24 * 14;
    await controller.setPiTokenFactory(wrapperFactory.address, {from: admin});
    await controller.replacePoolTokenWithExistingPiToken(sushi, wrappedSushiAddress, {from: admin});

    console.log('sushi balance after', await callContract(token, 'balanceOf', [pool.address]));
    console.log('sushi wrapper balance after', await callContract(token, 'balanceOf', [wrappedToken.address]));
    console.log('wrapped balance', await callContract(wrappedToken, 'balanceOf', [pool.address]));

    await router.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
    console.log('wrapped balance ratio 80%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

    await router.setReserveConfig(ether(0.2), '3600', {from: admin});
    // await router.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
    // console.log('wrapped balance ratio 20%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

    await increaseTime(MIN_REPORT_INTERVAL);
    await router.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
    console.log('wrapped balance ratio 20%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

    const staker = await IERC20.at(stakingAddr);
    console.log('staker.balanceOf(wrappedToken.address)', fromEther(await callContract(staker, 'balanceOf', [wrappedToken.address])));
    console.log('router.getSushiForXSushi', fromEther(await callContract(router, 'getSushiForXSushi', [await callContract(staker, 'balanceOf', [wrappedToken.address])])));

    await sushiToken.transfer(stakingAddr, ether(10000), {from: sushiHolder});
    await increaseTime(MIN_REPORT_INTERVAL);

    const tokens = await callContract(poolWrapper, 'getCurrentTokens');
    for(let i = 0; i < tokens.length; i++) {
      const t = await IERC20.at(tokens[i]);
      console.log(i, 'token balance before', fromEther(await callContract(t, 'balanceOf', [poolHolder])));
    }
    await pool.approve(poolWrapper.address, ether(10000), {from: poolHolder});
    await poolWrapper.exitPool(ether(10000), [1,1,1,1], {from: poolHolder});
    for(let i = 0; i < tokens.length; i++) {
      const t = await IERC20.at(tokens[i]);
      console.log(i, 'token balance after', tokens[i], fromEther(await callContract(t, 'balanceOf', [poolHolder])));
    }

    const newTokens = await callContract(pool, 'getCurrentTokens');
    for(let i = 0; i < newTokens.length; i++) {
      const t = await IERC20.at(newTokens[i]);
      console.log(i, 'new token balance after', newTokens[i], fromEther(await callContract(t, 'balanceOf', [poolHolder])));
    }
    console.log('balance of router before', fromEther(await callContract(token, 'balanceOf', [router.address])));
    await router.pokeFromReporter('1', true, powerPokeOpts, {from: pokerReporter});
    console.log('wrapped balance before', fromEther(await callContract(pool, 'getBalance', [wrappedToken.address])));
    console.log('balance of router after', fromEther(await callContract(token, 'balanceOf', [router.address])));
    console.log('balance of router after 2', fromEther(await callContract(token, 'balanceOf', [router.address])));
    console.log('wrapped balance after', fromEther(await callContract(pool, 'getBalance', [wrappedToken.address])));
    console.log('staker.balanceOf(wrappedToken.address)', fromEther(await callContract(staker, 'balanceOf', [wrappedToken.address])));
    console.log('router.getSushiForXSushi', fromEther(await callContract(router, 'getSushiForXSushi', [await callContract(staker, 'balanceOf', [wrappedToken.address])])));

    function ether(amount) {
      return toWei(amount.toString(), 'ether');
    }
  });

