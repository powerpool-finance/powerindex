require('@nomiclabs/hardhat-truffle5');

task('test-vested-lp-mining-pool', 'Test VestedLpMining Pool').setAction(async (__, { ethers }) => {
  const MockCvp = await artifacts.require('MockCvp');
  const MockERC20 = await artifacts.require('MockERC20');
  const VestedLPMining = await artifacts.require('VestedLPMining');
  const {callContract, fromEther, impersonateAccount, ether, advanceBlocks, forkContractUpgrade} = require('../test/helpers');

  const {web3} = VestedLPMining;
  const [deployer] = await web3.eth.getAccounts();
  const cvpAddress = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
  const proxyAddress = '0xF09232320eBEAC33fae61b24bB8D7CA192E58507';
  const testAddress = '0xc0bc7bbc9afa9b0577d10bd3eb636c8d3ab841d3';
  const admin = '0xB258302C3f209491d604165549079680708581Cc';
  const proxyAdminAddress = '0x4bb5A5b7E10C98884960bbDB9540cD1BaBdEac68';
  const lpMining = await VestedLPMining.at(proxyAddress);
  const lpAddress = '0x87b6f3a2dc6e541a9ce40e58f517953782ae614e';
  const boostRate = '385000000000000000000000000000';
  const poolId = '12';

  const cvp = await MockCvp.at(cvpAddress);
  const lp = await MockERC20.at(lpAddress);

  console.log('impersonateAccount');
  await impersonateAccount(ethers, testAddress);
  console.log('impersonateAccount');
  await impersonateAccount(ethers, admin);
  console.log('web3.eth.sendTransaction');
  await web3.eth.sendTransaction({
    from: deployer,
    to: admin,
    value: ether(1)
  });
  console.log('web3.eth.sendTransaction');
  await web3.eth.sendTransaction({
    from: deployer,
    to: testAddress,
    value: ether(1)
  });

  await forkContractUpgrade(ethers, admin, proxyAdminAddress, proxyAddress, await VestedLPMining.new().then(v => v.address))
  // await lpMining.updateBoostBalance({from: admin});

  // console.log('lpMining.add');
  // await lpMining.add('1', lpAddress, '1', false, boostRate, boostRate, ether('0.39'), ether('3.9'), {from: admin});
  console.log('boostRate', boostRate);
  console.log('_lpBoostMinRatio', ether('0.39'));
  console.log('_lpBoostMaxRatio', ether('3.9'));

  // const depositCvp = ether('39000');
  // const depositLp = ether('0.1');
  // console.log('cvp.transfer');
  // await cvp.transfer(testAddress, depositCvp, {from: admin});
  //
  // console.log('lp.approve');
  // await lp.approve(lpMining.address, depositLp, {from: testAddress});
  // console.log('cvp.approve');
  // await cvp.approve(lpMining.address, depositCvp, {from: testAddress});
  // console.log('lpMining.deposit', await callContract(lpMining, 'cvpBalanceToBoost', [depositLp, lpAddress, true]));
  //
  // const poolId = parseInt(await callContract(lpMining, 'poolLength')) - 1;
  // await lpMining.deposit(poolId, depositLp, depositCvp, {from: testAddress});
  // await lpMining.updatePool(poolId);
  // console.log('poolBoostByLp', await callContract(lpMining, 'poolBoostByLp', [poolId]));
  await lpMining.set(poolId, '1', '1', false, '1', '1', '0', '0', {from: admin});

  for(let i = 0; i < 20; i++) {
    // const blockBefore = await web3.eth.getBlockNumber();
    await advanceBlocks(6500);

    console.log('pended', fromEther(await callContract(lpMining, 'pendingCvp', [poolId, testAddress])));
    console.log('vested', fromEther(await callContract(lpMining, 'vestableCvp', [poolId, testAddress])));
    if (i) {
      continue;
    }
    const lptAmount = await callContract(lpMining, 'users', [poolId, testAddress]).then(r => r.lptAmount);
    const lpToken = await callContract(lpMining, 'pools', [poolId]).then(r => r.lpToken);
    const minCvpBalanceToBoost = await callContract(lpMining, 'cvpBalanceToBoost', [lptAmount, lpToken, true]);
    const maxCvpBalanceToBoost = await callContract(lpMining, 'cvpBalanceToBoost', [lptAmount, lpToken, false]);
    console.log('minCvpBalanceToBoost', fromEther(minCvpBalanceToBoost))
    console.log('maxCvpBalanceToBoost', fromEther(maxCvpBalanceToBoost))
    const cvpBalanceBefore = fromEther(await callContract(cvp, 'balanceOf', [testAddress]));
    const boostBalance = await callContract(lpMining, 'usersPoolBoost', [poolId, testAddress]).then(r => r.balance);
    console.log('boostBalance', fromEther(boostBalance))
    // console.log('blocks spent', res.receipt.blockNumber - blockBefore, 'cur block', res.receipt.blockNumber, 'vesting block', await lpMining.users(poolId, testAddress).then(r => r.vestingBlock.toString()))
    // await lpMining.withdraw(poolId, '0', boostBalance, {from: testAddress});
    await lpMining.deposit(poolId, '0', '0', {from: testAddress});
    // console.log('blocks spent', res.receipt.blockNumber - blockBefore, 'cur block', res.receipt.blockNumber, 'vesting block', await lpMining.users(poolId, testAddress).then(r => r.vestingBlock.toString()))
    const cvpBalanceAfter = fromEther(await callContract(cvp, 'balanceOf', [testAddress]));
    console.log('claimed after', i + 1, 'week', cvpBalanceAfter - cvpBalanceBefore - fromEther(boostBalance));
  }
});
