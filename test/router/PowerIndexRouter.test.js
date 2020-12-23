const { expectRevert } = require('@openzeppelin/test-helpers');
const { ether } = require('../helpers/index');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PowerIndexBasicRouter = artifacts.require('PowerIndexBasicRouter');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MockLeakingRouter = artifacts.require('MockLeakingRouter');

MockERC20.numberFormat = 'String';
PowerIndexBasicRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = MockERC20;

const ReserveStatus = {
  EQUILIBRIUM: 0,
  SHORTAGE: 1,
  EXCESS: 2
}

describe('PowerIndex BasicRouter Test', () => {
  let minter, bob, alice, stub;
  let poolRestrictions;

  before(async function () {
    [minter, bob, alice, stub] = await web3.eth.getAccounts();
    poolRestrictions = await PoolRestrictions.new();
  });

  describe('weighed underlying', () => {
    let leakingRouter, wrapper, token;

    beforeEach(async () => {
      token = await MockERC20.new('My Token 3', 'MT3', '18', ether('1000000'));
      wrapper = await WrappedPiErc20.new(token.address, stub, 'WToken', 'WTKN');
      leakingRouter = await MockLeakingRouter.new(wrapper.address, poolRestrictions.address);

      await wrapper.changeRouter(leakingRouter.address, { from: stub });
    })

    it('should', async () => {
      await token.transfer(alice, ether('100'));
      await token.approve(wrapper.address, ether('100'), { from: alice });
      await wrapper.deposit(ether('100'), { from: alice });
    })
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

    describe('getPiEquivalentFroUnderlyingPure()', async () => {
      it('should calculate valid values', async () => {
        // Case #1
        assert.equal(
          await router.getPiEquivalentFroUnderlyingPure(
            // amount
            ether(100),
            // totalUnderlyingWrapped
            ether(1000),
            // piTotalSupply
            ether(1200)
          ),
          ether(120)
        );

        // Case #2
        assert.equal(
          await router.getPiEquivalentFroUnderlyingPure(
            // amount
            ether(100),
            // totalUnderlyingWrapped
            ether(1000),
            // piTotalSupply
            ether(1000)
          ),
          ether(100)
        );

        // Case #3
        assert.equal(
          await router.getPiEquivalentFroUnderlyingPure(
            // amount
            ether(100),
            // totalUnderlyingWrapped
            ether(1600),
            // piTotalSupply
            ether(1000)
          ),
          ether(62.5)
        );

        // Case #4
        assert.equal(
          await router.getPiEquivalentFroUnderlyingPure(
            // amount
            ether(100),
            // totalUnderlyingWrapped
            ether(0),
            // piTotalSupply
            ether(0)
          ),
          ether(100)
        );

        // Case #5
        assert.equal(
          await router.getPiEquivalentFroUnderlyingPure(
            // amount
            ether(100),
            // totalUnderlyingWrapped
            ether(100),
            // piTotalSupply
            ether(100)
          ),
          ether(100)
        );

        // Case #6
        assert.equal(
          await router.getPiEquivalentFroUnderlyingPure(
            // amount
            ether(200),
            // totalUnderlyingWrapped
            ether(200),
            // piTotalSupply
            ether(100)
          ),
          ether(100)
        );
      });
    });

    describe('getExpectedReserveAmount()', async () => {
      it('should calculate values correctly', async () => {
        assert.equal(
          await router.getExpectedReserveAmount(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(800),
            // stakedBalance
            ether(200),
            // withdrawnAmount
            ether(50)
          ),
          ether(240)
        )
        assert.equal(
          await router.getExpectedReserveAmount(ether('0.2'), ether(800), ether(250), ether(50)),
          ether(250)
        )
        assert.equal(
          await router.getExpectedReserveAmount(ether('0.2'), ether(800), ether(150), ether(50)),
          ether(230)
        )
      })

      it('should correctly calculated with 0 RR', async () => {
        assert.equal(
          await router.getExpectedReserveAmount(ether(0), ether(800), ether(200), ether(50)),
          ether(50)
        )
      })
    })

    describe('getReserveStatusPure()', async () => {
      it('should deny calling with an invalid reserve ratio', async function () {
        await expectRevert(router.getReserveStatusPure(
          // reserveRatio, 1 eth == 100%
          ether('1.1'),
          // leftOnWrapper
          ether(200),
          // stakedBalance
          ether(800),
          // withdrawnAmount
          ether(50)
        ), 'RR_GREATER_THAN_100_PCT');
      })

      describe('SHORTAGE', async () => {
        it('should return with a shortage of the reserve', async () => {
          // Case #1
          let res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(200),
            // stakedBalance
            ether(800),
            // withdrawnAmount
            ether(50)
          );
          assert.equal(res.status, ReserveStatus.SHORTAGE);
          assert.equal(res.diff, ether(40));
          assert.equal(res.expectedReserveAmount, ether(240));

          // Case #2
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(200),
            // stakedBalance
            ether(850),
            // withdrawnAmount
            ether(50)
          );
          assert.equal(res.status, ReserveStatus.SHORTAGE);
          assert.equal(res.diff, ether(50));
          assert.equal(res.expectedReserveAmount, ether(250));

          // Case #3
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(200),
            // stakedBalance
            ether(800),
            // withdrawnAmount
            ether(500)
          );
          assert.equal(res.status, ReserveStatus.SHORTAGE);
          assert.equal(res.diff, ether(400));
          assert.equal(res.expectedReserveAmount, ether(600));

          // Case #4
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(50),
            // stakedBalance
            ether(1000),
            // withdrawnAmount
            ether(0)
          );
          assert.equal(res.status, ReserveStatus.SHORTAGE);
          assert.equal(res.diff, ether(160));
          assert.equal(res.expectedReserveAmount, ether(210));
        });
      })

      describe('EXCESS', async () => {
        it('should return with a excess of the reserve', async () => {
          // Case #1
          let res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(800),
            // stakedBalance
            ether(150),
            // withdrawnAmount
            ether(50)
          );
          assert.equal(res.status, ReserveStatus.EXCESS);
          assert.equal(res.diff, ether(570));
          assert.equal(res.expectedReserveAmount, ether(230));

          // Case #2
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(1000),
            // stakedBalance
            ether(0),
            // withdrawnAmount
            ether(50)
          );
          assert.equal(res.status, ReserveStatus.EXCESS);
          assert.equal(res.diff, ether(760));
          assert.equal(res.expectedReserveAmount, ether(240));

          // Case #3
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(2000),
            // stakedBalance
            ether(0),
            // withdrawnAmount
            ether(500)
          );
          assert.equal(res.status, ReserveStatus.EXCESS);
          assert.equal(res.diff, ether(1200));
          assert.equal(res.expectedReserveAmount, ether(800));

          // Case #4
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(250),
            // stakedBalance
            ether(800),
            // withdrawnAmount
            ether(0)
          );
          assert.equal(res.status, ReserveStatus.EXCESS);
          assert.equal(res.diff, ether(40));
          assert.equal(res.expectedReserveAmount, ether(210));

          // Case #4
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(300),
            // stakedBalance
            ether(800),
            // withdrawnAmount
            ether(0)
          );
          assert.equal(res.status, ReserveStatus.EXCESS);
          assert.equal(res.diff, ether(80));
          assert.equal(res.expectedReserveAmount, ether(220));

          // Case #5
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(850),
            // stakedBalance
            ether(150),
            // withdrawnAmount
            ether(0)
          );
          assert.equal(res.status, ReserveStatus.EXCESS);
          assert.equal(res.diff, ether(650));
          assert.equal(res.expectedReserveAmount, ether(200));

          // Case #6
          res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(1050),
            // stakedBalance
            ether(0),
            // withdrawnAmount
            ether(0)
          );
          assert.equal(res.status, ReserveStatus.EXCESS);
          assert.equal(res.diff, ether(840));
          assert.equal(res.expectedReserveAmount, ether(210));
        });
      })

      describe('EQUILIBRIUM', async () => {
        it('should return with an equlibrium for a deposit', async () => {
          const res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(200),
            // stakedBalance
            ether(800),
            // withdrawnAmount
            ether(0)
          );
          assert.equal(res.status, ReserveStatus.EQUILIBRIUM);
          assert.equal(res.diff, ether(0));
          assert.equal(res.expectedReserveAmount, ether(200));
        });

        it('should return with an equlibrium for a withdrawal', async () => {
          const res = await router.getReserveStatusPure(
            // reserveRatio, 1 eth == 100%
            ether('0.2'),
            // leftOnWrapper
            ether(250),
            // stakedBalance
            ether(800),
            // withdrawnAmount
            ether(50)
          );
          assert.equal(res.status, ReserveStatus.EQUILIBRIUM);
          assert.equal(res.diff, ether(0));
          assert.equal(res.expectedReserveAmount, ether(250));
        });
      })
    });
  });
});
