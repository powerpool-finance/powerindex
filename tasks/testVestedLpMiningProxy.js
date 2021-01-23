require('@nomiclabs/hardhat-truffle5');

const assert = require('assert');

task('test-vested-lp-mining-proxy', 'Test VestedLpMining').setAction(async (__, { ethers }) => {
  const VestedLPMining = await artifacts.require('VestedLPMining');
  const {forkContractUpgrade, callContract} = require('../test/helpers');

  const proxyAddress = '0xF09232320eBEAC33fae61b24bB8D7CA192E58507';
  const proxyAdminAddress = '0x4bb5A5b7E10C98884960bbDB9540cD1BaBdEac68';
  const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
  const newImplAddress = '0x2dc6b1b8dcf81b9060022c68b5611d480ff995c8';
  // const newImplAddress = (await VestedLPMining.new()).address;
  await forkContractUpgrade(ethers, OWNER, proxyAdminAddress, proxyAddress, newImplAddress)
  const newLpMining = await VestedLPMining.at(proxyAddress);

  assert.strictEqual(await callContract(newLpMining, 'cvp'), '0x38e4adB44ef08F22F5B5b76A8f0c2d0dCbE7DcA1');
  assert.strictEqual(await callContract(newLpMining, 'owner'), OWNER);
  assert.strictEqual(await callContract(newLpMining, 'reservoir'), '0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E');
  assert.strictEqual(await callContract(newLpMining, 'startBlock'), '11120828');
  assert.strictEqual(await callContract(newLpMining, 'poolPidByAddress', ['0xb4bebd34f6daafd808f73de0d10235a92fbb6c3d']), '9');
  assert.strictEqual(await callContract(newLpMining, 'users', ['2', '0x95d50631c0b4cf4b14a6753df6cc56dd31f6c814']).then(u => u.pendedCvp), '36114717399707938232');
  assert.strictEqual(await callContract(newLpMining, 'totalAllocPoint', []), '100001');
  assert.strictEqual(await callContract(newLpMining, 'cvpPoolByMetaPool', ['0x4cfa6c06b29a5d3e802b99ea747bc52d79f30942']), '0xb4bebD34f6DaaFd808f73De0d10235a92Fbb6c3D');
  assert.strictEqual(await callContract(newLpMining, 'lpBoostRatioByToken', ['0x4cfa6c06b29a5d3e802b99ea747bc52d79f30942']), '0');
  assert.strictEqual(await callContract(newLpMining, 'getPriorVotes', ['0x98e6abc306a6a04b67a274d7986d44760878fa48', '11711008']), '13216136578299655806119');
});
