require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-sushi-router-for-yeti', 'Deploy SUSHI Router for YETI')
  .setAction(async (__, {ethers, network}) => {
    const PowerIndexPoolController = await artifacts.require('PiptController');
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
    const admin = '0xb258302c3f209491d604165549079680708581cc';
    const poolAddress = '0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d';
    const pool = await PowerIndexPool.at(poolAddress);

    const poolWrapper = await PowerIndexWrapper.new(poolAddress, sendOptions);
    const wrapperFactory = await WrappedPiErc20Factory.new(sendOptions);
    const controller = await PowerIndexPoolController.new(poolAddress, poolWrapper.address, wrapperFactory.address, weightsStrategyAddr, sendOptions);
    await poolWrapper.setController(controller.address, sendOptions);

    await controller.transferOwnership(admin, sendOptions);

    if (network.name !== 'mainnetfork') {
      return;
    }
    const IERC20 = await artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');

    const sushiHolder = '0xe93381fb4c4f14bda253907b18fad305d799241a';
    const poolHolder = '0x87fc1313880d579039ac48db8b25428ed5f33c4a';
    const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
    const wrappedSushiAddress = '0x27aC37C9Ef42143EeE3B30fE6145efFBa554934F';

    await impersonateAccount(ethers, admin);
    await impersonateAccount(ethers, sushiHolder);
    await impersonateAccount(ethers, pokerReporter);
    await impersonateAccount(ethers, poolHolder);

    await pool.setController(controller.address, {from: admin});

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

    await increaseTime(60);

    await controller.finishReplace();

    await increaseTime(MIN_REPORT_INTERVAL);

    console.log('sushi balance after', fromEther(await callContract(sushiToken, 'balanceOf', [pool.address])));
    console.log('sushi wrapper balance after', fromEther(await callContract(sushiToken, 'balanceOf', [wrappedToken.address])));
    console.log('wrapped balance', fromEther(await callContract(wrappedToken, 'balanceOf', [pool.address])));

    await router.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
    console.log('sushi balance ratio 20%', fromEther(await callContract(sushiToken, 'balanceOf', [wrappedToken.address])));

    await router.setReserveConfig(ether(0.2), '3600', {from: admin});

    function ether(amount) {
      return toWei(amount.toString(), 'ether');
    }
  });

