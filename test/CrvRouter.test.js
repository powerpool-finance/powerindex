const { time, ether: rEther } = require('@openzeppelin/test-helpers');
const contract = require('@truffle/contract');
const fs = require('fs');
const assert = require('chai').assert;
const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const MockErc20Migrator = artifacts.require('MockErc20Migrator');
const PowerIndexRouter = artifacts.require('CurvePowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const AragonVoting = artifacts.require('AragonVoting');

MockERC20.numberFormat = 'String';
MockErc20Migrator.numberFormat = 'String';
BPool.numberFormat = 'String';
PowerIndexPoolController.numberFormat = 'String';
PowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = BFactory;

function ether(value) {
  return rEther(value.toString()).toString(10);
}

//TODO: resolve "Smart contract depositors not allowed" revert
describe.skip('CrvRouter Tests', () => {
  let minter, bob, alice, yearnOwner;

  before(async function () {
    [minter, bob, alice, yearnOwner] = await web3.eth.getAccounts();
  });

  it('should correctly vote for CRV voting', async () => {
    const crv = await MockERC20.new('CRV', 'CRV', '18', ether('1000000'));
    // https://etherscan.io/address/0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2
    const CrvStackingContract = await contract({
      abi: getFileContent('CrvVotingAbi.json'),
      bytecode: getFileContent('CrvVoting', {encoding: 'utf8'}).replace('d533a949740bb3306d119cc777fa900ba034cd52', crv.address.replace('0x', ''))
    });

    CrvStackingContract.setProvider(web3.currentProvider);

    const crvStacking = await CrvStackingContract.new({from: minter});

    console.log('crvStacking.contract.methods', crvStacking.contract.methods)

    const crvVoting = await AragonVoting.new(
      crvStacking.address,
      '600000000000000000',
      '150000000000000000',
      '604800',
      '2500000000000000000000',
      '43200',
      '2500000000000000000000',
      '50000000000000000000000',
      '43200',
      '1209600'
    );

    const poolRestrictions = await PoolRestrictions.new();
    const router = await PowerIndexRouter.new(poolRestrictions.address, '86400');
    const crvWrapper = await WrappedPiErc20.new(crv.address, router.address, 'WCRV', 'WCRV');

    await router.setVotingAndStackingForWrappedToken(crvWrapper.address, crvVoting.address, crvStacking.address);
    await router.setReserveRatioForWrappedToken(crvWrapper.address, ether('0.2'));

    assert.equal(await router.owner(), minter);

    await crv.transfer(alice, ether('10000'));
    await crv.approve(crvWrapper.address, ether('10000'), { from: alice });
    const res = await crvWrapper.deposit(ether('10000'), { from: alice });
    const logCallVoting = WrappedPiErc20.decodeLogs(res.receipt.rawLogs).filter(l => l.event === 'CallVoting')[0];
    console.log("logCallVoting", logCallVoting);

    //
    // assert.equal(await crvWrapper.totalSupply(), ether('10000'));
    // assert.equal(await crvWrapper.balanceOf(alice), ether('10000'));
    //
    // // The router has partially staked the deposit with regard to the reserve ration value (20/80)
    // assert.equal(await yfi.balanceOf(crvWrapper.address), ether(2000));
    // assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8000));
    //
    // // The votes are allocated on the crvWrapper contract
    // assert.equal(await yearnGovernance.balanceOf(crvWrapper.address), ether(8000));
    //
    // const proposalString = 'Lets do it';
    //
    // await poolRestrictions.setVotingAllowedForSenders(yearnGovernance.address, [alice], [true]);
    //
    // await router.executeRegister(crvWrapper.address, { from: alice });
    // await router.executePropose(crvWrapper.address, bob, proposalString, { from: alice });
    // await router.executeVoteFor(crvWrapper.address, 0, { from: alice });
    //
    // await time.advanceBlockTo((await time.latestBlock()).toNumber() + 10);
    //
    // await yearnGovernance.tallyVotes(0);
    //
    // const proposal = await yearnGovernance.proposals(0);
    // assert.equal(proposal.open, false);
    // assert.equal(proposal.totalForVotes, ether(8000));
    // assert.equal(proposal.totalAgainstVotes, ether(0));
    // assert.equal(proposal.hash, proposalString);
  });
});

function getFileContent(fileName) {
  return fs.readFileSync('contracts/test/curve/' + fileName, {encoding: 'utf8'});
}
