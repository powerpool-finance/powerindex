require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-sushi-router-for-assy', 'Deploy SUSHI Router for ASSY')
  .setAction(async (__, {ethers, network}) => {
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const PowerIndexWrapper = await artifacts.require('PowerIndexWrapper');
    const WrappedPiErc20Factory = await artifacts.require('WrappedPiErc20Factory');
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const PowerIndexRouterFactory = await artifacts.require('SushiPowerIndexRouterFactory');
    const PowerPoke = await artifacts.require('PowerPoke');

    const {impersonateAccount, callContract, increaseTime, forkReplacePoolTokenWithNewPiToken, fromEther, gwei} = require('../test/helpers');
    const {buildSushiRouterArgs} = require('../test/helpers/builders');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();
    console.log('deployer', deployer);
    // const sendOptions = {from: deployer};

    const sushi = '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2';
    const votingAddr = '0x0000000000000000000000000000000000000000';
    const stakingAddr = '0x8798249c2e607446efb7ad49ec89dd1865ff4272';
    const admin = '0xb258302c3f209491d604165549079680708581cc';
    const poolAddress = '0xfa2562da1bba7b954f26c74725df51fb62646313';
    const cvpAddress = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
    const pool = await PowerIndexPool.at(poolAddress);
    const poolRestrictionsAddress = '0x3885c4e1107b445dd370d09008d90b5153132fff';

    const poolWrapper = await PowerIndexWrapper.at('0x43fa8ef8e334720b80367cf94e438cf90c562abe');
    const controller = await PowerIndexPoolController.at('0x99655673c57a29518c60775252716c320a9e7d2f');
    const sushiRouterFactory = await PowerIndexRouterFactory.at('0x64c389529ceb54bcd8dc5166855109678416e001');
    const wrapperFactory = await WrappedPiErc20Factory.at('0x9cdda9f8a4533d829b424f47ac9a7850e46982e3');

    if (network.name !== 'mainnetfork') {
      return;
    }
    const IERC20 = await artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');

    const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';
    const sushiHolder = '0xe93381fb4c4f14bda253907b18fad305d799241a';
    const poolHolder = '0xa36c6df92a5bef87a5de6b71cb92fba3e16f0a43';
    const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';

    await impersonateAccount(ethers, admin);
    await impersonateAccount(ethers, sushiHolder);
    await impersonateAccount(ethers, pokerReporter);
    await impersonateAccount(ethers, poolHolder);

    const sushiToken = await IERC20.at(sushi);

    const testWallet = ethers.Wallet.createRandom();
    const powerPokeOpts = web3.eth.abi.encodeParameter(
      { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
      {to: testWallet.address, compensateInETH: true},
    );

    const BONUS_NUMERATOR = '7610350076';
    const BONUS_DENUMERATOR = '10000000000000000';
    const MIN_REPORT_INTERVAL = 60 * 60 * 24 * 14;
    const MAX_REPORT_INTERVAL = MIN_REPORT_INTERVAL + 60 * 60;
    const MAX_GAS_PRICE = gwei(500);
    const PER_GAS = '10000';
    const MIN_SLASHING_DEPOSIT = ether(40);

    // const newController = await PowerIndexPoolController.new(poolAddress, poolWrapper.address, wrapperFactory.address, '0x25be31ca0b36d5077a922d4ee54c08111a7e034e');
    // await newController.transferOwnership(admin, {from: deployer});

    // await controller.migrateController(newController.address, [poolAddress, poolWrapper.address], {from: admin});
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
        powerPoke: powerPokeAddress,
        voting: votingAddr,
        staking: stakingAddr,
        reserveRatio: ether(0.2),
        reserveRatioToForceRebalance: ether(0.05),
        claimRewardsInterval: 60 * 60 * 24 * 7,
        pvpFee: ether(0.003),
        pvp: '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
        rewardPools: ['0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d', '0xfa2562da1bba7b954f26c74725df51fb62646313'],
      }, {
        SUSHI: sushi,
      }),
      admin,
      'sushi'
    );

    console.log('wrappedToken.address', wrappedToken.address);

    const powerPoke = await PowerPoke.at(powerPokeAddress);
    await powerPoke.addClient(router.address, admin, true, MAX_GAS_PRICE, MIN_REPORT_INTERVAL, MAX_REPORT_INTERVAL, {from: admin});
    await powerPoke.setMinimalDeposit(router.address, MIN_SLASHING_DEPOSIT, {from: admin});
    await powerPoke.setBonusPlan(router.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {from: admin});
    await powerPoke.setFixedCompensations(router.address, 200000, 60000, {from: admin});

    const cvp = await IERC20.at(cvpAddress);
    await cvp.approve(powerPoke.address, ether(10000), {from: admin});
    await powerPoke.addCredit(router.address, ether(10000), {from: admin});

    console.log('sushi balance after', fromEther(await callContract(token, 'balanceOf', [pool.address])));
    console.log('sushi wrapper balance after', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));
    console.log('wrapped balance', await callContract(wrappedToken, 'balanceOf', [pool.address]));

    await router.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
    console.log('sushi balance ratio 20%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

    await router.setReserveConfig(ether(0.2), '3600', {from: admin});
    // await router.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
    // console.log('wrapped balance ratio 20%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

    await increaseTime(MIN_REPORT_INTERVAL);
    await router.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
    console.log('sushi balance ratio 20%', fromEther(await callContract(token, 'balanceOf', [wrappedToken.address])));

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

    const sushiBalance = await callContract(sushiToken, 'balanceOf', [poolHolder]);
    await sushiToken.approve(poolWrapper.address, sushiBalance, {from: poolHolder});
    await poolWrapper.swapExactAmountIn(sushiToken.address, sushiBalance, tokens[0], '1', ether(1000), {from: poolHolder})
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

