const { time, ether: rEther } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const BFactory = artifacts.require('BFactory');
const BPool = artifacts.require('BPool');
const MockERC20 = artifacts.require('MockERC20');
const PowerIndexPoolController = artifacts.require('PowerIndexPoolController');
const MockErc20Migrator = artifacts.require('MockErc20Migrator');
const PowerIndexRouter = artifacts.require('PowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockYearnGovernance = artifacts.require('MockYearnGovernance');

MockERC20.numberFormat = 'String';
MockErc20Migrator.numberFormat = 'String';
BPool.numberFormat = 'String';
PowerIndexPoolController.numberFormat = 'String';
PowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
MockYearnGovernance.numberFormat = 'String';

const { web3 } = BFactory;

function ether(value) {
  return rEther(value.toString()).toString(10);
}

describe('PowerIndexRouter Tests', () => {
  let minter, bob, alice, yearnOwner;

  before(async function () {
    [minter, bob, alice, yearnOwner] = await web3.eth.getAccounts();
  });

  it('should allow creating a proposal in YFI', async () => {
    const yfi = await MockERC20.new('yearn.finance', 'YFI', '18', ether('1000000'));
    const yearnGovernance = await MockYearnGovernance.new();

    const poolRestrictions = await PoolRestrictions.new();
    const router = await PowerIndexRouter.new(poolRestrictions.address);
    const yfiWrapper = await WrappedPiErc20.new(yfi.address, router.address, 'wrapped.yearn.finance', 'WYFI');

    await yearnGovernance.initialize(0, yearnOwner, yfi.address);
    await router.setVotingForWrappedToken(yfiWrapper.address, yearnGovernance.address);
    await router.setReserveRatioForWrappedToken(yfiWrapper.address, ether('0.2'));

    assert.equal(await router.owner(), minter);

    await yfi.transfer(alice, ether('10000'));
    await yfi.approve(yfiWrapper.address, ether('10000'), { from: alice });
    await yfiWrapper.deposit(ether('10000'), { from: alice });

    assert.equal(await yfiWrapper.totalSupply(), ether('10000'));
    assert.equal(await yfiWrapper.balanceOf(alice), ether('10000'));

    // The router has partially staked the deposit with regard to the reserve ration value (20/80)
    assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(2000));
    assert.equal(await yfi.balanceOf(yearnGovernance.address), ether(8000));

    // The votes are allocated on the yfiWrapper contract
    assert.equal(await yearnGovernance.balanceOf(yfiWrapper.address), ether(8000));

    const proposalString = 'Lets do it';

    await poolRestrictions.setVotingAllowedForSenders(yearnGovernance.address, [alice], [true]);

    await router.executeRegister(yfiWrapper.address, { from: alice });
    await router.executePropose(yfiWrapper.address, bob, proposalString, { from: alice });
    await router.executeVoteFor(yfiWrapper.address, 0, { from: alice });

    await time.advanceBlockTo((await time.latestBlock()).toNumber() + 10);

    await yearnGovernance.tallyVotes(0);

    const proposal = await yearnGovernance.proposals(0);
    assert.equal(proposal.open, false);
    assert.equal(proposal.totalForVotes, ether(8000));
    assert.equal(proposal.totalAgainstVotes, ether(0));
    assert.equal(proposal.hash, proposalString);
  });
});
