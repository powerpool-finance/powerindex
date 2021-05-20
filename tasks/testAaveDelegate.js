require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('test-aave-delegate', 'Test AAVE Delegate')
  .setAction(async (__, {ethers, network}) => {
    const PowerIndexPool = await artifacts.require('PowerIndexPool');
    const PoolRestrictions = await artifacts.require('PoolRestrictions');
    const PowerIndexPoolController = await artifacts.require('PowerIndexPoolController');
    const IAave = await artifacts.require('IAave');

    const {impersonateAccount, callContract, increaseTime, forkReplacePoolTokenWithNewPiToken} = require('../test/helpers');
    const {buildAaveRouterArgs} = require('../test/helpers/builders');
    const {web3} = PowerIndexPoolController;
    const {toWei} = web3.utils;

    const [deployer] = await web3.eth.getAccounts();
    console.log('deployer', deployer);
    const sendOptions = {from: deployer};

    const aave = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
    const admin = '0xb258302c3f209491d604165549079680708581cc';
    const piptAddress = '0x26607ac599266b21d13c7acf7942c7701a8b699c';
    const assyAddress = '0xfa2562da1bba7b954f26c74725df51fb62646313';
    const delegatee = '0xE353233f078D1f4b9f5e467Aa5b46f5f931E2A0c';
    const piptPool = await PowerIndexPool.at(piptAddress);
    const assyPool = await PowerIndexPool.at(assyAddress);
    const poolRestrictionsAddress = await callContract(piptPool, 'getRestrictions');
    const poolRestrictions = await PoolRestrictions.at(poolRestrictionsAddress);
    const aaveToken = await IAave.at(aave);

    if (network.name !== 'mainnetfork') {
      return;
    }
    await impersonateAccount(ethers, admin);
    console.log('getPowerCurrent', await callContract(aaveToken, 'getPowerCurrent', [delegatee, '0']));
    const assyController = await PowerIndexPoolController.at(await callContract(assyPool, 'getController'));

    await poolRestrictions.setVotingSignaturesForAddress(aave, [true], ['0x5c19a95c'], [true], {from: admin});
    await poolRestrictions.setTotalRestrictions([assyAddress], ['0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'], {from: admin});
    await poolRestrictions.setVotingAllowedForSenders(aave, [admin], [true], {from: admin});

    const sig = '0x5c19a95c';
    const args = web3.eth.abi.encodeParameter('address', delegatee);

    const piptData = piptPool.contract.methods.callVoting(aave, sig, args, '0').encodeABI();
    let gasLimit = Math.round((await web3.eth.estimateGas({
      from: admin,
      to: piptPool.address,
      data: piptData
    })) * 1.1);
    console.log('target', piptPool.address, 'gasLimit', gasLimit, 'piptData', piptData);
    await web3.eth.sendTransaction({
      from: admin,
      to: piptPool.address,
      data: piptData,
      gasLimit
    });

    console.log('getPowerCurrent', await callContract(aaveToken, 'getPowerCurrent', [delegatee, '0']));

    const setRestrictionsData = assyPool.contract.methods.setRestrictions(poolRestrictions.address).encodeABI();
    const controllerSetRestrictionsData = assyController.contract.methods.callPool(setRestrictionsData.slice(0, 10), '0x' + setRestrictionsData.slice(10)).encodeABI();
    gasLimit = Math.round((await web3.eth.estimateGas({
      from: admin,
      to: assyController.address,
      data: controllerSetRestrictionsData
    })) * 1.1);
    console.log('target', assyController.address, 'gasLimit', gasLimit, 'controllerSetRestrictionsData', controllerSetRestrictionsData);
    await web3.eth.sendTransaction({
      from: admin,
      to: assyController.address,
      data: controllerSetRestrictionsData,
      gasLimit
    });

    const assyData = assyController.contract.methods.callVotingByPool(aave, sig, args, '0').encodeABI();
    gasLimit = Math.round((await web3.eth.estimateGas({
      from: admin,
      to: assyController.address,
      data: assyData
    })) * 1.1);
    console.log('target', assyController.address, 'gasLimit', gasLimit, 'assyData', assyData);

    await web3.eth.sendTransaction({
      from: admin,
      to: assyController.address,
      data: assyData,
      gasLimit
    });
    console.log('getPowerCurrent', await callContract(aaveToken, 'getPowerCurrent', [delegatee, '0']));
  });

