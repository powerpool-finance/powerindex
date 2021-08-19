const { ether, deployProxied } = require('../helpers/index');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const xCVP = artifacts.require('xCVP');

MockERC20.numberFormat = 'String';
xCVP.numberFormat = 'String';

const { web3 } = MockERC20;

describe('xCVP test', () => {
  let deployer, bob, alice;
  let cvp;
  let xCvp;

  before(async function() {
    [deployer, bob, alice] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    cvp = await MockERC20.new('CVP', 'CVP', '18', ether(200000));

    xCvp = await deployProxied(xCVP, [cvp.address], [], { proxyAdminOwner: deployer });
  });

  it('should initialize upgradeable xCVP correctly', async () => {
    assert.equal(await xCvp.cvp(), cvp.address);
    assert.equal(await xCvp.name(), 'Staked Concentrated Voting Power');
    assert.equal(await xCvp.symbol(), 'xCVP');
    assert.equal(await xCvp.decimals(), 18);
  });

  it('should distribute CVP rewards over the stakers', async () => {
    await cvp.transfer(alice, ether(1000));
    await cvp.transfer(bob, ether(3000));

    // enter
    await cvp.approve(xCvp.address, ether(1000), { from: alice });
    await xCvp.enter(ether(1000), { from: alice });

    await cvp.approve(xCvp.address, ether(3000), { from: bob });
    await xCvp.enter(ether(3000), { from: bob });

    assert.equal(await xCvp.totalSupply(), ether(4000));
    assert.equal(await xCvp.balanceOf(alice), ether(1000));
    assert.equal(await xCvp.balanceOf(bob), ether(3000));

    assert.equal(await cvp.balanceOf(alice), ether(0));
    assert.equal(await cvp.balanceOf(bob), ether(0));

    // transfer rewards
    await cvp.transfer(xCvp.address, ether(1000));

    assert.equal(await xCvp.totalSupply(), ether(4000));
    assert.equal(await xCvp.balanceOf(alice), ether(1000));
    assert.equal(await xCvp.balanceOf(bob), ether(3000));

    // leave
    await xCvp.leave(ether(1000), { from: alice });
    await xCvp.leave(ether(3000), { from: bob });

    assert.equal(await xCvp.totalSupply(), ether(0));
    assert.equal(await xCvp.balanceOf(alice), ether(0));
    assert.equal(await xCvp.balanceOf(bob), ether(0));

    assert.equal(await cvp.balanceOf(alice), ether(1250));
    assert.equal(await cvp.balanceOf(bob), ether(3750));
  });
});
