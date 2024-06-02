const { constants } = require('@openzeppelin/test-helpers');
const { ether } = require('../../helpers');
const { buildBasicRouterConfig, buildSushiRouterConfig } = require('../../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const SushiPowerIndexRouter = artifacts.require('SushiPowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const SushiBar = artifacts.require('SushiBar');
const MockPoke = artifacts.require('MockPoke');
const MockPool = artifacts.require('MockPool');

MockERC20.numberFormat = 'String';
SushiPowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
SushiBar.numberFormat = 'String';

const { web3 } = MockERC20;

const REPORTER_ID = 42;

describe('SushiRouter Stories', () => {
  let alice, bob, charlie, piGov, stub, pvp;

  before(async function () {
    [, alice, bob, charlie, piGov, stub, pvp] = await web3.eth.getAccounts();
  });

  let sushi, xSushi, poolRestrictions, piSushi, sushiRouter, pool;

  beforeEach(async function () {
    // 0x6b3595068778dd592e39a122f4f5a5cf09c90fe2
    sushi = await MockERC20.new('SushiToken', 'SUSHI', '18', ether('10000000'));

    // 0x8798249c2e607446efb7ad49ec89dd1865ff4272
    xSushi = await SushiBar.new(sushi.address);

    poolRestrictions = await PoolRestrictions.new();
    piSushi = await WrappedPiErc20.new(sushi.address, stub, 'Wrapped SUSHI', 'piSUSHI');
    const poke = await MockPoke.new(true);
    pool = await MockPool.new();
    sushiRouter = await SushiPowerIndexRouter.new(
      piSushi.address,
      buildBasicRouterConfig(
        poolRestrictions.address,
        poke.address,
        constants.ZERO_ADDRESS,
        xSushi.address,
        ether('0.2'),
        ether('0.02'),
        ether('0.3'),
        '0',
        pvp,
        ether('0.15'),
        [pool.address]
      ),
      buildSushiRouterConfig(
        sushi.address
      ),
    );

    await piSushi.changeRouter(sushiRouter.address, { from: stub });

    await sushiRouter.transferOwnership(piGov);

    assert.equal(await sushiRouter.owner(), piGov);
  });

  it('story #1', async () => {
    await sushi.transfer(alice, ether(42000));
    await sushi.transfer(bob, ether(42000));
    await sushi.transfer(charlie, ether(42000));

    ///////////////////////////////////////////
    // Step #1. Charlie stakes at Bar 150 SUSHI
    await sushi.approve(xSushi.address, ether(150), { from: charlie });
    await xSushi.enter(ether(150), { from: charlie });

    // assertions
    assert.equal(await xSushi.totalSupply(), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));
    assert.equal(await sushi.balanceOf(xSushi.address), ether(150));
    assert.equal(await sushiRouter.getPendingRewards(), '0');

    //////////////////////////////////////
    // Step #2. Reward assignment 50 SUSHI
    await sushi.transfer(xSushi.address, ether(50));

    // assertions
    assert.equal(await xSushi.totalSupply(), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));
    assert.equal(await sushi.balanceOf(xSushi.address), ether(200));

    assert.equal(await sushiRouter.getUnderlyingStaked(), ether(0));
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1333333333333333333');
    assert.equal(await sushiRouter.getPendingRewards(), '0');

    //////////////////////////////////////
    // Step #3. Alice router deposit 125 SUSHI
    await sushi.approve(piSushi.address, ether(125), { from: alice });
    await piSushi.deposit(ether(125), { from: alice });

    await sushiRouter.pokeFromReporter(REPORTER_ID, false, '0x');

    // assertions
    assert.equal(await piSushi.totalSupply(), ether(125));
    assert.equal(await piSushi.balanceOf(alice), ether(125));

    assert.equal(await sushi.balanceOf(piSushi.address), ether(25));
    assert.equal(await sushi.balanceOf(xSushi.address), ether(300));

    assert.equal(await xSushi.totalSupply(), ether(225));
    assert.equal(await xSushi.balanceOf(piSushi.address), ether(75));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));

    assert.equal(await sushiRouter.getUnderlyingStaked(), ether(100));
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1333333333333333333');
    assert.equal(await sushiRouter.getPendingRewards(), '0');

    //////////////////////////////////////
    // Step #4. Bob router deposit 250 SUSHI
    await sushi.approve(piSushi.address, ether(250), { from: bob });
    await piSushi.deposit(ether(250), { from: bob });

    await sushiRouter.pokeFromReporter(REPORTER_ID, false, '0x');

    // assertions
    assert.equal(await piSushi.totalSupply(), ether(375));
    assert.equal(await piSushi.balanceOf(alice), ether(125));
    assert.equal(await piSushi.balanceOf(bob), ether(250));

    assert.equal(await sushi.balanceOf(piSushi.address), ether(75));
    assert.equal(await sushi.balanceOf(xSushi.address), ether(500));

    assert.equal(await xSushi.totalSupply(), ether(375));
    assert.equal(await xSushi.balanceOf(piSushi.address), ether(225));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));

    assert.equal(await sushiRouter.getUnderlyingStaked(), ether(300));
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1333333333333333333');
    assert.equal(await sushiRouter.getPendingRewards(), '0');

    /////////////////////////////////////////
    // Step #5. Alice stakes at Bar 200 SUSHI
    await sushi.approve(xSushi.address, ether(200), { from: alice });
    await xSushi.enter(ether(200), { from: alice });

    // assertions
    assert.equal(await piSushi.totalSupply(), ether(375));
    assert.equal(await piSushi.balanceOf(alice), ether(125));
    assert.equal(await piSushi.balanceOf(bob), ether(250));

    assert.equal(await sushi.balanceOf(piSushi.address), ether(75));
    assert.equal(await sushi.balanceOf(xSushi.address), ether(700));

    assert.equal(await xSushi.totalSupply(), ether(525));
    assert.equal(await xSushi.balanceOf(piSushi.address), ether(225));
    assert.equal(await xSushi.balanceOf(alice), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));

    assert.equal(await sushiRouter.getUnderlyingStaked(), ether(300));
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), ether(300));
    assert.equal(await sushiRouter.getPendingRewards(), '0');
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1333333333333333333');

    ///////////////////////////////////////
    // Step #6. Reward assignment 150 SUSHI
    assert.equal(await sushiRouter.getSushiForXSushi(await xSushi.balanceOf(piSushi.address)), '300000000000000000000');

    await sushi.transfer(xSushi.address, ether(150));

    // assertions
    assert.equal(await piSushi.totalSupply(), ether(375));
    assert.equal(await piSushi.balanceOf(alice), ether(125));
    assert.equal(await piSushi.balanceOf(bob), ether(250));

    assert.equal(await sushi.balanceOf(piSushi.address), ether(75));
    assert.equal(await sushi.balanceOf(xSushi.address), ether(850));

    assert.equal(await xSushi.totalSupply(), ether(525));
    assert.equal(await xSushi.balanceOf(piSushi.address), ether(225));
    assert.equal(await xSushi.balanceOf(alice), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));

    assert.equal(await sushiRouter.getUnderlyingStaked(), ether(300));
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), '364285714285714285714');
    assert.equal(await sushiRouter.getPendingRewards(), '64285714285714285715');
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1619047619047619047');

    /////////////////////////////////////////
    // Step #7. Alice router deposit 60 SUSHI
    await sushi.approve(piSushi.address, ether(60), { from: alice });
    await piSushi.deposit(ether(60), { from: alice });

    await sushiRouter.pokeFromReporter(REPORTER_ID, false, '0x');

    // assertions
    assert.equal(await piSushi.totalSupply(), ether(435));
    assert.equal(await piSushi.balanceOf(alice), ether(185));
    assert.equal(await piSushi.balanceOf(bob), ether(250));

    assert.equal(await sushi.balanceOf(piSushi.address), ether(87));
    assert.equal(await sushi.balanceOf(xSushi.address), ether(898));

    assert.equal(await xSushi.totalSupply(), '554647058823529411764');
    assert.equal(await xSushi.balanceOf(piSushi.address), '254647058823529411764');
    assert.equal(await xSushi.balanceOf(alice), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));

    assert.equal(await sushiRouter.getUnderlyingStaked(), ether(348));
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), '412285714285714285713');
    assert.equal(await sushiRouter.getPendingRewards(), '64285714285714285714');
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1619047619047619047');

    ///////////////////////////////////////////
    // Step #8. Bob router withdrawal 100 SUSHI
    await sushiRouter.setReserveConfig(ether('0.4'), ether('0.1'), ether('0.5'),'0', {from: piGov})
    await sushiRouter.pokeFromReporter(REPORTER_ID, false, '0x');

    assert.equal(await sushi.balanceOf(piSushi.address), '173999999999999999999');
    assert.equal(await sushi.balanceOf(xSushi.address), '811000000000000000001');
    assert.equal(await xSushi.balanceOf(piSushi.address), '200911764705882352941');

    await piSushi.approve(piSushi.address, ether(100), { from: bob });
    await piSushi.withdraw(ether(100), { from: bob });

    await sushiRouter.setReserveConfig(ether('0.2'), ether('0.1'), ether('0.5'), '0', {from: piGov})
    await sushiRouter.pokeFromReporter(REPORTER_ID, false, '0x');

    // assertions
    assert.equal(await piSushi.totalSupply(), ether(335));
    assert.equal(await piSushi.balanceOf(alice), ether(185));
    assert.equal(await piSushi.balanceOf(bob), ether(150));

    assert.equal(await sushi.balanceOf(piSushi.address), '67000000000000000000');
    assert.equal(await sushi.balanceOf(xSushi.address), '818000000000000000000');

    assert.equal(await xSushi.totalSupply(), '505235294117647058822');
    assert.equal(await xSushi.balanceOf(piSushi.address), '205235294117647058822');
    assert.equal(await xSushi.balanceOf(alice), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));

    assert.equal(await sushiRouter.getUnderlyingStaked(), '268000000000000000000');
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), '332285714285714285712');
    assert.equal(await sushiRouter.getPendingRewards(), '64285714285714285713');
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1619047619047619047');

    /////////////////////////////////////////////
    // Step #9. Router Claims Rewards 64.28... SUSHI
    assert.equal(await sushiRouter.getSushiForXSushi(await xSushi.balanceOf(piSushi.address)), '332285714285714285712');

    await piSushi.transfer(pool.address, ether(1), {from: alice})
    await sushiRouter.pokeFromReporter(REPORTER_ID, true, '0x');

    assert.equal(await sushiRouter.getSushiForXSushi(await xSushi.balanceOf(piSushi.address)), '268000000000000000001');

    // assertions
    assert.equal(await piSushi.totalSupply(), '389642857142857142855');
    assert.equal(await piSushi.balanceOf(alice), ether(184));
    assert.equal(await piSushi.balanceOf(bob), ether(150));

    assert.equal(await sushi.balanceOf(piSushi.address), '121642857142857142855');
    assert.equal(await sushi.balanceOf(xSushi.address), '753714285714285714289');

    assert.equal(await xSushi.totalSupply(), '465529411764705882353');
    assert.equal(await xSushi.balanceOf(piSushi.address), '165529411764705882353');
    assert.equal(await xSushi.balanceOf(alice), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(150));

    assert.equal(await sushiRouter.getUnderlyingStaked(), '268000000000000000000');
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), '268000000000000000001');
    assert.equal(await sushiRouter.getPendingRewards(), '2');
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1619047619047619047');

    /////////////////////////////////////////////
    // Step #10. Charlie leaves SushiBar 150 xSUSHI
    await xSushi.leave(ether(150), { from: charlie });

    // assertions
    assert.equal(await piSushi.totalSupply(), '389642857142857142855');
    assert.equal(await piSushi.balanceOf(alice), ether(184));
    assert.equal(await piSushi.balanceOf(bob), ether(150));

    assert.equal(await sushi.balanceOf(piSushi.address), '121642857142857142855');
    assert.equal(await sushi.balanceOf(xSushi.address), '510857142857142857146');

    assert.equal(await xSushi.totalSupply(), '315529411764705882353');
    assert.equal(await xSushi.balanceOf(piSushi.address), '165529411764705882353');
    assert.equal(await xSushi.balanceOf(alice), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(0));

    assert.equal(await sushiRouter.getUnderlyingStaked(), '268000000000000000000');
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), '268000000000000000001');
    assert.equal(await sushiRouter.getPendingRewards(), '2');
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1619047619047619047');

    //////////////////////////////////////////////
    // Step #11. Alice router withdrawal 185 SUSHI
    await pool.transfer(piSushi.address, alice, ether(1));

    await sushiRouter.setReserveConfig(ether('0.8'), ether('0.1'), ether('0.9'), '0', {from: piGov})
    await sushiRouter.pokeFromReporter(REPORTER_ID, false, '0x');

    await piSushi.withdraw(ether(185), { from: alice });

    await sushiRouter.setReserveConfig(ether('0.2'), ether('0.1'), ether('0.5'), '0', {from: piGov})
    await sushiRouter.pokeFromReporter(REPORTER_ID, false, '0x');

    // assertions
    assert.equal(await piSushi.totalSupply(), '204642857142857142855');
    assert.equal(await piSushi.balanceOf(alice), ether(0));
    assert.equal(await piSushi.balanceOf(bob), ether(150));

    assert.equal(await sushi.balanceOf(piSushi.address), '40928571428571428571');
    assert.equal(await sushi.balanceOf(xSushi.address), '406571428571428571430');

    assert.equal(await xSushi.totalSupply(), '251117647058823529410');
    assert.equal(await xSushi.balanceOf(piSushi.address), '101117647058823529410');
    assert.equal(await xSushi.balanceOf(alice), ether(150));
    assert.equal(await xSushi.balanceOf(charlie), ether(0));

    assert.equal(await sushiRouter.getUnderlyingStaked(), '163714285714285714284');
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), '163714285714285714284');
    assert.equal(await sushiRouter.getPendingRewards(), '0');
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1619047619047619047');

    /////////////////////////////////////////////
    // Step #12. Alice leaves SushiBar 150 xSUSHI
    await xSushi.leave(ether(150), { from: alice });

    // assertions
    assert.equal(await piSushi.totalSupply(), '204642857142857142855');
    assert.equal(await piSushi.balanceOf(alice), ether(0));
    assert.equal(await piSushi.balanceOf(bob), ether(150));

    assert.equal(await sushi.balanceOf(piSushi.address), '40928571428571428571');
    assert.equal(await sushi.balanceOf(xSushi.address), '163714285714285714285');

    assert.equal(await xSushi.totalSupply(), '101117647058823529410');
    assert.equal(await xSushi.balanceOf(piSushi.address), '101117647058823529410');
    assert.equal(await xSushi.balanceOf(alice), ether(0));
    assert.equal(await xSushi.balanceOf(charlie), ether(0));

    assert.equal(await sushiRouter.getUnderlyingStaked(), '163714285714285714284');
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), '163714285714285714285');
    assert.equal(await sushiRouter.getPendingRewards(), '2');
    assert.equal(await sushiRouter.getSushiForXSushi(ether(1)), '1619047619047619047');

    //////////////////////////////////////////////////////////////////////////////////
    // Step #13. Bob router withdrawal 150 SUSHI - 5 wei
    await sushiRouter.setReserveConfig(ether(1), ether('0.5'), ether(1), '0', {from: piGov})
    await sushiRouter.pokeFromReporter(REPORTER_ID, false, '0x');

    await piSushi.withdraw('149999999999999999995', { from: bob });
    // await pool.transfer(piSushi.address, alice, ether(1));

    console.log(await piSushi.balanceOf(pool.address));

    // assertions
    assert.equal(await piSushi.balanceOf(pool.address), '54642857142857142855');
    assert.equal(await piSushi.totalSupply(), '54642857142857142860');
    assert.equal(await piSushi.balanceOf(alice), ether(0));
    assert.equal(await piSushi.balanceOf(bob), '5');

    assert.equal(await sushi.balanceOf(piSushi.address), '54642857142857142859');
    assert.equal(await sushi.balanceOf(xSushi.address), '2');

    assert.equal(await xSushi.totalSupply(), '1');
    assert.equal(await xSushi.balanceOf(piSushi.address), '1');
    assert.equal(await xSushi.balanceOf(alice), ether(0));
    assert.equal(await xSushi.balanceOf(charlie), ether(0));

    assert.equal(await sushiRouter.getUnderlyingStaked(), '1');
    assert.equal(await sushiRouter.getUnderlyingBackedByXSushi(), '2');
    assert.equal(await sushiRouter.getPendingRewards(), '2');
  });
});
