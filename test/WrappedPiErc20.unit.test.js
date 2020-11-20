const { expectEvent, expectRevert, ether: rEther } = require('@openzeppelin/test-helpers');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockYearnGovernance = artifacts.require('MockYearnGovernance');
const MockRouter = artifacts.require('MockRouter');

MockERC20.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
MockYearnGovernance.numberFormat = 'String';
MockRouter.numberFormat = 'String';

const { web3 } = MockERC20;

function ether(value) {
  return rEther(value.toString()).toString(10);
}

function signatureAndArgs(payload) {
  assert(payload.length > 11, 'Payload too small');
  return {
    signature: payload.substr(0, 10),
    args: `0x${payload.substr(10, payload.length - 1)}`,
  }
}

describe.only('WrappedPiErc20 Unit Tests', () => {
  let bob, alice;
  let yfi, router, yfiWrapper;

  before(async function () {
    [bob, alice] = await web3.eth.getAccounts();
  });

  beforeEach(async function () {
    yfi = await MockERC20.new('yearn.finance', 'YFI', 18, ether('1000000'));
    router = await MockRouter.new(alice);
    yfiWrapper = await WrappedPiErc20.new(yfi.address, router.address, 'wrapped.yearn.finance', 'WYFI');
  });

  it('should initialize correctly', async () => {
    assert.equal(await yfiWrapper.name(), 'wrapped.yearn.finance');
    assert.equal(await yfiWrapper.symbol(), 'WYFI');
    assert.equal(await yfiWrapper.token(), yfi.address);
    assert.equal(await yfiWrapper.router(), router.address);
    assert.equal(await yfiWrapper.totalSupply(), 0);
  });

  describe('deposit', async () => {
    beforeEach(async () => {
      await yfi.transfer(alice, ether('10000'));
    });

    it('should mint the same token amount that was deposited', async () => {
      assert.equal(await yfi.balanceOf(alice), ether(10000))
      assert.equal(await yfi.balanceOf(yfiWrapper.address), ether(0))

      await yfi.approve(yfiWrapper.address, ether(42), { from: alice });
      const res = await yfiWrapper.deposit(ether(42), { from: alice });

      expectEvent(res, 'Deposit', {
        account: alice,
        amount: ether(42)
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
  });

  describe('withdraw', async () => {
    beforeEach(async () => {
      await yfi.transfer(alice, ether('10000'));

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
        amount: ether(42)
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
        const data = await yfiWrapper.contract.methods.approveToken(bob, ether(55)).encodeABI();
        const res = await router.execute(yfiWrapper.address, data);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'Approve', {
          to: bob,
          amount: ether(55),
        })
        assert.equal(await yfi.allowance(yfiWrapper.address, bob), ether(55));
      })

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(yfiWrapper.approveToken(alice, ether(33), { from: alice }), 'ONLY_ROUTER');
      })
    })

    describe('callVoting', async () => {
      let signature, args;
      beforeEach(async () => {
        const data = await router.contract.methods.wrapperCallback(ether(15)).encodeABI();
        ({ signature, args } = signatureAndArgs(data));
      });

      it('should allow the router calling any method on any contract', async () => {
        const data2 = await yfiWrapper.contract.methods.callVoting(router.address, signature, args, 0).encodeABI();
        const res = await router.execute(yfiWrapper.address, data2);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'CallVoting', {
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
        await expectRevert(yfiWrapper.callVoting(alice, signature, args, 0, { from: alice }), 'ONLY_ROUTER');
      })
    })
  })
});
