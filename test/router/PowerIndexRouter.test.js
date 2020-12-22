const { expectRevert } = require('@openzeppelin/test-helpers');
const { ether } = require('../helpers/index');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PowerIndexBasicRouter = artifacts.require('PowerIndexBasicRouter');
const PoolRestrictions = artifacts.require('PoolRestrictions');

MockERC20.numberFormat = 'String';
PowerIndexBasicRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = MockERC20;

describe('PowerIndex BasicRouter Test', () => {
  let minter, bob, alice, stub;
  let poolRestrictions;

  before(async function () {
    [minter, bob, alice, stub] = await web3.eth.getAccounts();
    poolRestrictions = await PoolRestrictions.new();
  });

  describe('changeRouter()', () => {
    it('should allow swapping a token with a new version', async () => {
      const token = await MockERC20.new('My Token 3', 'MT3', '18', ether('1000000'));
      const wrapper = await WrappedPiErc20.new(token.address, stub, 'WToken', 'WTKN');
      const router = await PowerIndexBasicRouter.new(wrapper.address, poolRestrictions.address);
      const router2 = await PowerIndexBasicRouter.new(wrapper.address, poolRestrictions.address);

      await wrapper.changeRouter(router.address, { from: stub });

      assert.equal(await router.owner(), minter);

      await token.transfer(alice, ether('100'));
      await token.approve(wrapper.address, ether('100'), { from: alice });
      await wrapper.deposit(ether('100'), { from: alice });

      assert.equal(await wrapper.totalSupply(), ether('100'));
      assert.equal(await wrapper.balanceOf(alice), ether('100'));

      await expectRevert(wrapper.changeRouter(bob), 'ONLY_ROUTER');
      await router.migrateToNewRouter(wrapper.address, router2.address);

      assert.equal(await wrapper.router(), router2.address);

      await wrapper.approve(wrapper.address, ether('100'), { from: alice });
      await wrapper.withdraw(ether('100'), { from: alice });

      assert.equal(await wrapper.totalSupply(), ether('0'));
      assert.equal(await wrapper.balanceOf(alice), ether('0'));
      assert.equal(await token.balanceOf(alice), ether('100'));
    });
  });

  describe('pure functions', () => {
    let router;

    before(async () => {
      const token = await MockERC20.new('My Token 3', 'MT3', '18', ether('1000000'));
      const wrapper = await WrappedPiErc20.new(token.address, stub, 'WToken', 'WTKN');
      router = await PowerIndexBasicRouter.new(wrapper.address, poolRestrictions.address);
    });

    describe('calculateAdjustedReserveAmount()', async () => {
      //
      //                           / %reserveRatio * (staked + leftOnWrapper) \
      // adjustedReserveAmount =  | -------------------------------------------| + withdrawAmount
      //                           \                  100%                    /
      //
      it('should calculate values correctly', async () => {
        assert.equal(
          await router.calculateReserveRatio(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(800),
            // stakedBalance
            ether(200),
            // withdrawnAmount
            ether(50)
          ),
          ether(250)
        )
      })

      it('should handle 0 reserve ratio', async () => {
        assert.equal(
          await router.calculateReserveRatio(
            // reserveRatio, 1 eth == 100%
            ether(0),
            // leftOnWrapper
            ether(800),
            // stakedBalance
            ether(200),
            // withdrawnAmount
            ether(50)
          ),
          ether(50)
        )
      })

      it('should ignore 0 withdrawnAmount', async () => {
        assert.equal(
          await router.calculateReserveRatio(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(800),
            // stakedBalance
            ether(200),
            // withdrawnAmount
            ether(0)
          ),
          ether(200)
        )
      })
    })
  })
});
