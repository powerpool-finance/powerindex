const { expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { ether } = require('../helpers/index');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockYearnGovernance = artifacts.require('MockYearnGovernance');
const MockRouter = artifacts.require('MockRouter');
const MockLeakingRouter = artifacts.require('MockLeakingRouter');

MockERC20.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
MockYearnGovernance.numberFormat = 'String';
MockRouter.numberFormat = 'String';

const { web3 } = MockERC20;

function signatureAndArgs(payload) {
  assert(payload.length > 11, 'Payload too small');
  return {
    signature: payload.substr(0, 10),
    args: `0x${payload.substr(10, payload.length - 1)}`,
  }
}

describe('WrappedPiErc20 Unit Tests', () => {
  let alice, bob, stub;
  let yfi, router, yfiWrapper;

  before(async function () {
    [, alice, bob, stub] = await web3.eth.getAccounts();
  });

  beforeEach(async function () {
    yfi = await MockERC20.new('yearn.finance', 'YFI', 18, ether('1000000'));
    yfiWrapper = await WrappedPiErc20.new(yfi.address, stub, 'wrapped.yearn.finance', 'WYFI');
    router = await MockRouter.new(yfiWrapper.address, stub);
    await yfiWrapper.changeRouter(router.address, { from: stub });
  });

  it('should initialize correctly', async () => {
    assert.equal(await yfiWrapper.name(), 'wrapped.yearn.finance');
    assert.equal(await yfiWrapper.symbol(), 'WYFI');
    assert.equal(await yfiWrapper.underlying(), yfi.address);
    assert.equal(await yfiWrapper.router(), router.address);
    assert.equal(await yfiWrapper.totalSupply(), 0);
  });

  describe('deposit', async () => {
    beforeEach(async () => {
      await yfi.transfer(alice, ether('10000'));
    });

    it('should mint the same token amount that was deposited for a balanced wrapper', async () => {
      assert.equal(await yfi.balanceOf(alice), ether(10000))
      assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(0))

      await yfi.approve(yfiWrapper.address, ether(42), { from: alice });
      const res = await yfiWrapper.deposit(ether(42), { from: alice });

      expectEvent(res, 'Deposit', {
        account: alice,
        undelyingDeposited: ether(42),
        piMinted: ether(42)
      })

      assert.equal(await yfi.balanceOf(alice), ether(9958))
      assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(42))

      assert.equal(await yfiWrapper.totalSupply(), ether(42));
      assert.equal(await yfiWrapper.balanceOf(alice), ether(42));
    });

    it('should call the router callback with 0', async () => {
      await yfi.approve(yfiWrapper.address, ether(42), { from: alice });
      const res = await yfiWrapper.deposit(ether(42), { from: alice });
      await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
        withdrawAmount: '0'
      })
    });

    it('should revert if there isn not enough approval', async () => {
      await expectRevert(
        yfiWrapper.deposit(ether(42), { from: alice }),
        'ERC20: transfer amount exceeds allowance'
      );
    });

    it('should deny depositing 0', async () => {
      await expectRevert(
        yfiWrapper.deposit(ether(0), { from: alice }),
        'ZERO_DEPOSIT'
      );
    });

    describe('imbalanced router', () => {
      let leakingRouter;

      beforeEach(async () => {
        leakingRouter = await MockLeakingRouter.new(yfiWrapper.address, stub);
        await router.migrateToNewRouter(yfiWrapper.address, leakingRouter.address);

        assert.equal(await yfi.balanceOf(alice), ether(10000))
        assert.equal(await yfi.balanceOf(bob), ether(0))

        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(0))
        assert.equal(await yfiWrapper.totalSupply(), ether(0))
      });

      it('should mint greater pi amount for a negatively imbalanced router', async () => {
        // Drain 200 yfi from the wrapper token
        await yfi.approve(yfiWrapper.address, ether(1200), { from: alice });
        await yfiWrapper.deposit(ether(1200), { from: alice });
        await leakingRouter.drip(stub, ether(200));
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1000))
        assert.equal(await yfiWrapper.totalSupply(), ether(1200))
        await yfi.transfer(bob, ether(100), { from: alice })

        // Deposit
        await yfi.approve(yfiWrapper.address, ether(100), { from: bob });
        const res = await yfiWrapper.deposit(ether(100), { from: bob });

        expectEvent(res, 'Deposit', {
          account: bob,
          undelyingDeposited: ether(100),
          piMinted: ether(120)
        })

        assert.equal(await yfi.balanceOf(bob), ether(0))
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1100))

        assert.equal(await yfiWrapper.totalSupply(), ether(1320));
        assert.equal(await yfiWrapper.balanceOf(bob), ether(120));
      });

      it('should mint smaller pi amount for a positively imbalanced router', async () => {
        // Add 400 extra yfi to the wrapper
        await yfi.approve(yfiWrapper.address, ether(1000), { from: alice });
        await yfiWrapper.deposit(ether(1000), { from: alice });
        await yfi.transfer(yfiWrapper.address, ether(600), { from: alice })
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1600))
        assert.equal(await yfiWrapper.totalSupply(), ether(1000))
        await yfi.transfer(bob, ether(100), { from: alice })

        // Deposit
        await yfi.approve(yfiWrapper.address, ether(100), { from: bob });
        const res = await yfiWrapper.deposit(ether(100), { from: bob });

        expectEvent(res, 'Deposit', {
          account: bob,
          undelyingDeposited: ether(100),
          piMinted: ether(62.5)
        })

        assert.equal(await yfi.balanceOf(bob), ether(0))
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1700))

        assert.equal(await yfiWrapper.totalSupply(), ether(1062.5));
        assert.equal(await yfiWrapper.balanceOf(bob), ether(62.5));
      });
    });
  });

  describe('withdraw', async () => {
    beforeEach(async () => {
      await yfi.transfer(alice, ether('10000'));
    });

    describe('balanced wrapper', () => {
      beforeEach(async () => {
        await yfi.approve(yfiWrapper.address, ether(42), { from: alice });
        await yfiWrapper.deposit(ether(42), { from: alice });
      });

      it('should charge the same token amount that was returned', async () => {
        assert.equal(await yfi.balanceOf(alice), ether(9958))
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(42))
        assert.equal(await yfiWrapper.balanceOf(alice), ether(42))

        await yfiWrapper.approve(yfiWrapper.address, ether(42), { from: alice });
        const res = await yfiWrapper.withdraw(ether(42), { from: alice });

        expectEvent(res, 'Withdraw', {
          account: alice,
          underlyingWithdrawn: ether(42),
          piBurned: ether(42)
        })

        assert.equal(await yfi.balanceOf(alice), ether(10000))
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(0))

        assert.equal(await yfiWrapper.totalSupply(), ether(0));
        assert.equal(await yfiWrapper.balanceOf(alice), ether(0));
      });

      it('should call the router callback with the returned amount', async () => {
        await yfiWrapper.approve(yfiWrapper.address, ether(42), { from: alice });
        const res = await yfiWrapper.withdraw(ether(42), { from: alice });
        await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
          withdrawAmount: ether(42)
        })
      });

      it('should revert if there isn not enough approval', async () => {
        await expectRevert(
          yfiWrapper.withdraw(ether(42), { from: alice }),
          'ERC20: transfer amount exceeds allowance'
        );
      });

      it('should deny withdrawing 0', async () => {
        await expectRevert(
          yfiWrapper.withdraw(ether(0), { from: alice }),
          'ZERO_WITHDRAWAL'
        );
      });
    })

    describe('imbalanced wrapper', () => {
      let leakingRouter;

      beforeEach(async () => {
        leakingRouter = await MockLeakingRouter.new(yfiWrapper.address, stub);
        await router.migrateToNewRouter(yfiWrapper.address, leakingRouter.address);

        assert.equal(await yfi.balanceOf(bob), ether(0))
      });

      it('should burn greater pi amount for a negatively imbalanced router', async () => {
        await yfi.approve(yfiWrapper.address, ether(1200), { from: alice });
        await yfiWrapper.deposit(ether(1200), { from: alice });
        // Drain 200 yfi from the wrapper token
        await leakingRouter.drip(stub, ether(200));
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1000))
        assert.equal(await yfiWrapper.totalSupply(), ether(1200))
        await yfiWrapper.transfer(bob, ether(120), { from: alice })

        // Withdraw
        await yfiWrapper.approve(yfiWrapper.address, ether(120), { from: bob });
        const res = await yfiWrapper.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(120)
        })

        assert.equal(await yfi.balanceOf(bob), ether(100))
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(900))

        assert.equal(await yfiWrapper.totalSupply(), ether(1080));
        assert.equal(await yfiWrapper.balanceOf(bob), ether(0));
      });

      it('should burn smaller pi amount for a positively imbalanced router', async () => {
        await yfi.approve(yfiWrapper.address, ether(1000), { from: alice });
        await yfiWrapper.deposit(ether(1000), { from: alice });
        await yfi.transfer(yfiWrapper.address, ether(600), { from: alice })
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1600))
        assert.equal(await yfiWrapper.totalSupply(), ether(1000))
        await yfiWrapper.transfer(bob, ether(62.5), { from: alice })

        // Withdraw
        await yfiWrapper.approve(yfiWrapper.address, ether(62.5), { from: bob });
        const res = await yfiWrapper.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(62.5)
        })

        assert.equal(await yfi.balanceOf(bob), ether(100))
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(1500))

        assert.equal(await yfiWrapper.totalSupply(), ether(937.5));
        assert.equal(await yfiWrapper.balanceOf(bob), ether(0));
      });

      it('should allow draining a negatively imbalanced router', async () => {
        await yfi.approve(yfiWrapper.address, ether(200), { from: alice });
        await yfiWrapper.deposit(ether(200), { from: alice });
        await leakingRouter.drip(stub, ether(100));
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(100))
        assert.equal(await yfiWrapper.totalSupply(), ether(200))

        await yfiWrapper.transfer(bob, ether(200), { from: alice })

        // Withdraw
        await yfiWrapper.approve(yfiWrapper.address, ether(200), { from: bob });
        const res = await yfiWrapper.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(200)
        })

        assert.equal(await yfi.balanceOf(bob), ether(100))
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(0))

        assert.equal(await yfiWrapper.totalSupply(), ether(0));
        assert.equal(await yfiWrapper.balanceOf(bob), ether(0));
      });

      it('should allow draining a positively imbalanced router', async () => {
        await yfi.approve(yfiWrapper.address, ether(100), { from: alice });
        await yfiWrapper.deposit(ether(100), { from: alice });
        await yfi.transfer(yfiWrapper.address, ether(100), { from: alice })
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(200))
        assert.equal(await yfiWrapper.totalSupply(), ether(100))
        await yfiWrapper.transfer(bob, ether(100), { from: alice })

        // Withdraw
        await yfiWrapper.approve(yfiWrapper.address, ether(100), { from: bob });
        const res = await yfiWrapper.withdraw(ether(200), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(200),
          piBurned: ether(100)
        })

        assert.equal(await yfi.balanceOf(bob), ether(200))
        assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(0))

        assert.equal(await yfiWrapper.totalSupply(), ether(0));
        assert.equal(await yfiWrapper.balanceOf(bob), ether(0));
      });
    });
  });

  describe('router interface', async () => {
    describe('changeRouter', async () => {
      it('should allow changing a router', async () => {
        const data = await yfiWrapper.contract.methods.changeRouter(alice).encodeABI();
        const res = await router.execute(yfiWrapper.address, data);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'ChangeRouter', {
          newRouter: alice,
        })
        assert.equal(await yfiWrapper.router(), alice);
      })

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(yfiWrapper.changeRouter(alice, { from: alice }), 'ONLY_ROUTER');
      })
    })

    describe('approveToken', async () => {
      it('should allow the router approving locked tokens', async () => {
        const data = await yfiWrapper.contract.methods.approveUnderlying(bob, ether(55)).encodeABI();
        const res = await router.execute(yfiWrapper.address, data);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'Approve', {
          to: bob,
          amount: ether(55),
        })
        assert.equal(await yfi.allowance(yfiWrapper.address, bob), ether(55));
      })

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(yfiWrapper.approveUnderlying(alice, ether(33), { from: alice }), 'ONLY_ROUTER');
      })
    })

    describe('callVoting', async () => {
      let signature, args;
      beforeEach(async () => {
        const data = await router.contract.methods.wrapperCallback(ether(15)).encodeABI();
        ({ signature, args } = signatureAndArgs(data));
      });

      it('should allow the router calling any method on any contract', async () => {
        const data2 = await yfiWrapper.contract.methods.callExternal(router.address, signature, args, 0).encodeABI();
        const res = await router.execute(yfiWrapper.address, data2);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'CallExternal', {
          voting: router.address,
          inputSig: web3.utils.padRight(signature, 64),
          inputData: args,
          success: true,
        })

        await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
          withdrawAmount: ether(15),
        })
      })

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(yfiWrapper.callExternal(alice, signature, args, 0, { from: alice }), 'ONLY_ROUTER');
      })
    })
  })
});
