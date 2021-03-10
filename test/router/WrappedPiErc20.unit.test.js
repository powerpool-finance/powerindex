const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { ether, expectExactRevert, splitPayload, toEvmBytes32 } = require('../helpers/index');
const { buildBasicRouterConfig } = require('../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockYearnGovernance = artifacts.require('MockYearnGovernance');
const MockRouter = artifacts.require('MockRouter');
const MyContract = artifacts.require('MyContract');
const MockPoke = artifacts.require('MockPoke');

MyContract.numberFormat = 'String';
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
  };
}

describe('WrappedPiErc20 Unit Tests', () => {
  let owner, alice, bob, stub, mockStaking;
  let yfi, router, piYfi, myContract, defaultBasicConfig;

  beforeEach(async function () {
    [owner, alice, bob, stub, mockStaking] = await web3.eth.getAccounts();
    myContract = await MyContract.new();
    const poke = await MockPoke.new();
    defaultBasicConfig = buildBasicRouterConfig(
      stub,
      poke.address,
      constants.ZERO_ADDRESS,
      constants.ZERO_ADDRESS,
      ether('0.2'),
      ether('0.02'),
      '0',
      stub,
      ether(0),
      []
    );
  });

  beforeEach(async function () {
    yfi = await MockERC20.new('yearn.finance', 'YFI', 18, ether('1000000'));
    piYfi = await WrappedPiErc20.new(yfi.address, stub, 'wrapped.yearn.finance', 'piYFI');
    router = await MockRouter.new(piYfi.address, defaultBasicConfig);
    await piYfi.changeRouter(router.address, { from: stub });

    await router.setMockStaking(yfi.address, mockStaking);
    await yfi.transfer(mockStaking, ether(50));
  });

  it('should initialize correctly', async () => {
    assert.equal(await piYfi.name(), 'wrapped.yearn.finance');
    assert.equal(await piYfi.symbol(), 'piYFI');
    assert.equal(await piYfi.underlying(), yfi.address);
    assert.equal(await piYfi.router(), router.address);
    assert.equal(await piYfi.totalSupply(), 0);
  });

  describe('callExternal', async () => {
    beforeEach(async () => {
      await router.migrateToNewRouter(piYfi.address, alice);
    });

    it('should call the external methods', async () => {
      await myContract.transferOwnership(piYfi.address);
      const payload = splitPayload(myContract.contract.methods.setAnswer(42).encodeABI());

      assert.equal(await myContract.getAnswer(), 0);
      const res = await piYfi.callExternal(myContract.address, payload.signature, payload.calldata, 0, {
        from: alice,
      });
      assert.equal(await myContract.getAnswer(), 42);
      expectEvent(res, 'CallExternal', {
        destination: myContract.address,
        inputSig: toEvmBytes32(payload.signature),
        inputData: payload.calldata,
        outputData: '0x000000000000000000000000000000000000000000000000000000000000007b',
      });
    });

    it('should call the multiple external methods', async () => {
      await myContract.transferOwnership(piYfi.address);
      const payload = splitPayload(myContract.contract.methods.setAnswer(42).encodeABI());
      const payload2 = splitPayload(myContract.contract.methods.setAnswer2(24).encodeABI());

      assert.equal(await myContract.getAnswer(), 0);
      await piYfi.callExternalMultiple([{
        destination: myContract.address,
        signature: payload.signature,
        args: payload.calldata,
        value: 0,
      },{
        destination: myContract.address,
        signature: payload2.signature,
        args: payload2.calldata,
        value: 0,
      }], {
        from: alice,
      });
      assert.equal(await myContract.getAnswer(), 42);
      assert.equal(await myContract.getAnswer2(), 24);
    });

    it('should deny non-router calling the method', async () => {
      const payload = splitPayload(myContract.contract.methods.setAnswer(42).encodeABI());

      await expectExactRevert(
        piYfi.callExternal(myContract.address, payload.signature, payload.calldata, 0, { from: alice }),
        'Ownable: caller is not the owner',
      );

      await expectExactRevert(
        piYfi.callExternalMultiple([{
          destination: myContract.address,
          signature: payload.signature,
          args: payload.calldata,
          value: 0,
        }], { from: alice }),
        'Ownable: caller is not the owner',
      );
    });

    it('should use default revert message for an empty returndata', async () => {
      const data = myContract.contract.methods.revertWithoutString().encodeABI();
      await expectExactRevert(
        piYfi.callExternal(myContract.address, data, '0x', 0, { from: alice }),
        'REVERTED_WITH_NO_REASON_STRING',
      );
    });

    it('should use the response revert message when reverting', async () => {
      const data = myContract.contract.methods.revertWithString().encodeABI();
      await expectExactRevert(
        piYfi.callExternal(myContract.address, data, '0x', 0, { from: alice }),
        'some-unique-revert-string',
      );
    });

    it('should use a long response revert message when reverting', async () => {
      const data = myContract.contract.methods.revertWithLongString().encodeABI();
      await expectExactRevert(
        piYfi.callExternal(myContract.address, data, '0x', 0, { from: alice }),
        'some-unique-revert-string-that-is-a-bit-longer-than-a-single-evm-slot',
      );
    });

    it('should use default revert message when getting invalid opcode', async () => {
      const data = myContract.contract.methods.invalidOp().encodeABI();
      await expectExactRevert(
        piYfi.callExternal(myContract.address, data, '0x', 0, { from: alice }),
        'REVERTED_WITH_NO_REASON_STRING',
      );
    });
  });

  describe('deposit', async () => {
    beforeEach(async () => {
      await yfi.transfer(alice, ether('10000'));
    });

    it('should mint the same token amount that was deposited for a balanced wrapper', async () => {
      assert.equal(await yfi.balanceOf(alice), ether(10000));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(0));

      await yfi.approve(piYfi.address, ether(42), { from: alice });
      const res = await piYfi.deposit(ether(42), { from: alice });

      expectEvent(res, 'Deposit', {
        account: alice,
        undelyingDeposited: ether(42),
        piMinted: ether(42),
      });

      assert.equal(await yfi.balanceOf(alice), ether(9958));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(42));

      assert.equal(await piYfi.totalSupply(), ether(42));
      assert.equal(await piYfi.balanceOf(alice), ether(42));
    });

    it('should call the router callback with 0', async () => {
      await yfi.approve(piYfi.address, ether(42), { from: alice });
      const res = await piYfi.deposit(ether(42), { from: alice });
      await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
        withdrawAmount: '0',
      });
    });

    it('should revert if there isn not enough approval', async () => {
      await expectRevert(piYfi.deposit(ether(42), { from: alice }), 'ERC20: transfer amount exceeds allowance');
    });

    it('should deny depositing 0', async () => {
      await expectRevert(piYfi.deposit(ether(0), { from: alice }), 'ZERO_DEPOSIT');
    });

    it('should take fee if set', async () => {
      assert.equal(await piYfi.ethFee(), ether(0));

      const ethFee = ether(0.001);

      await router.setPiTokenEthFee(ethFee, { from: owner });

      assert.equal(await piYfi.ethFee(), ethFee);

      await yfi.approve(piYfi.address, ether(42), { from: alice });
      await expectRevert(piYfi.deposit(ether(42), { from: alice }), 'FEE');

      assert.equal(await web3.eth.getBalance(router.address), 0);

      const res = await piYfi.deposit(ether(42), { from: alice, value: ethFee });

      expectEvent(res, 'Deposit', {
        account: alice,
        undelyingDeposited: ether(42),
        piMinted: ether(42),
      });

      assert.equal(await yfi.balanceOf(alice), ether(9958));
      assert.equal(await yfi.balanceOf(piYfi.address), ether(42));

      assert.equal(await piYfi.totalSupply(), ether(42));
      assert.equal(await piYfi.balanceOf(alice), ether(42));

      assert.equal(await web3.eth.getBalance(piYfi.address), 0);
      assert.equal(await web3.eth.getBalance(router.address), ethFee);
    });

    describe('imbalanced router', () => {
      beforeEach(async () => {
        assert.equal(await yfi.balanceOf(alice), ether(10000));
        assert.equal(await yfi.balanceOf(bob), ether(0));

        assert.equal(await yfi.balanceOf(piYfi.address), ether(0));
        assert.equal(await piYfi.totalSupply(), ether(0));
      });

      it('should mint greater pi amount for a negatively imbalanced router', async () => {
        // Drain 200 yfi from the wrapper token
        await yfi.approve(piYfi.address, ether(1200), { from: alice });
        await piYfi.deposit(ether(1200), { from: alice });
        await router.drip(stub, ether(200));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(1000));
        assert.equal(await piYfi.totalSupply(), ether(1200));
        assert.equal(await yfi.balanceOf(piYfi.address), await piYfi.totalSupplyUnderlying());

        const underlyingDeposit = ether(100);
        const piEquivalent = ether(120);
        await yfi.transfer(bob, underlyingDeposit, { from: alice });

        // Deposit
        await yfi.approve(piYfi.address, underlyingDeposit, { from: bob });
        const res = await piYfi.deposit(underlyingDeposit, { from: bob });

        expectEvent(res, 'Deposit', {
          account: bob,
          undelyingDeposited: underlyingDeposit,
          piMinted: piEquivalent,
        });

        assert.equal(await yfi.balanceOf(bob), ether(0));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(1100));

        assert.equal(await yfi.balanceOf(piYfi.address), await piYfi.totalSupplyUnderlying());
        assert.equal(await piYfi.totalSupply(), ether(1320));
        assert.equal(await piYfi.balanceOf(bob), piEquivalent);
        assert.equal(await piYfi.balanceOfUnderlying(bob), underlyingDeposit);
      });

      it('should mint smaller pi amount for a positively imbalanced router', async () => {
        // Add 400 extra yfi to the wrapper
        await yfi.approve(piYfi.address, ether(1000), { from: alice });
        await piYfi.deposit(ether(1000), { from: alice });
        await yfi.transfer(piYfi.address, ether(600), { from: alice });
        assert.equal(await yfi.balanceOf(piYfi.address), ether(1600));
        assert.equal(await piYfi.totalSupply(), ether(1000));
        assert.equal(await yfi.balanceOf(piYfi.address), await piYfi.totalSupplyUnderlying());
        await yfi.transfer(bob, ether(100), { from: alice });

        // Deposit
        const underlyingDeposit = ether(100);
        const piEquivalent = ether(62.5);
        await yfi.approve(piYfi.address, underlyingDeposit, { from: bob });
        const res = await piYfi.deposit(underlyingDeposit, { from: bob });

        expectEvent(res, 'Deposit', {
          account: bob,
          undelyingDeposited: underlyingDeposit,
          piMinted: piEquivalent,
        });

        assert.equal(await yfi.balanceOf(bob), ether(0));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(1700));

        assert.equal(await yfi.balanceOf(piYfi.address), await piYfi.totalSupplyUnderlying());
        assert.equal(await piYfi.totalSupply(), ether(1062.5));
        assert.equal(await piYfi.balanceOf(bob), piEquivalent);
        assert.equal(await piYfi.balanceOfUnderlying(bob), underlyingDeposit);
      });
    });
  });

  describe('withdraw', async () => {
    beforeEach(async () => {
      await yfi.transfer(alice, ether('10000'));
    });

    describe('balanced wrapper', () => {
      beforeEach(async () => {
        await yfi.approve(piYfi.address, ether(42), { from: alice });
        await piYfi.deposit(ether(42), { from: alice });
      });

      it('should charge the same token amount that was returned', async () => {
        assert.equal(await yfi.balanceOf(alice), ether(9958));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(42));
        assert.equal(await piYfi.balanceOf(alice), ether(42));

        const res = await piYfi.withdraw(ether(42), { from: alice });

        expectEvent(res, 'Withdraw', {
          account: alice,
          underlyingWithdrawn: ether(42),
          piBurned: ether(42),
        });

        assert.equal(await yfi.balanceOf(alice), ether(10000));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(0));

        assert.equal(await piYfi.totalSupply(), ether(0));
        assert.equal(await piYfi.balanceOf(alice), ether(0));
      });

      it('should call the router callback with the returned amount', async () => {
        const res = await piYfi.withdraw(ether(42), { from: alice });
        await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
          withdrawAmount: ether(42),
        });
      });

      it('should revert if there isn not enough balance', async () => {
        await expectRevert(piYfi.withdraw(ether(43), { from: alice }), 'ERC20: burn amount exceeds balance');
      });

      it('should deny withdrawing 0', async () => {
        await expectRevert(piYfi.withdraw(ether(0), { from: alice }), 'ZERO_WITHDRAWAL');
      });

      it('should take fee if set', async () => {
        assert.equal(await piYfi.ethFee(), ether(0));

        const ethFee = ether(0.001);

        await router.setPiTokenEthFee(ethFee, { from: owner });

        assert.equal(await piYfi.ethFee(), ethFee);

        assert.equal(await web3.eth.getBalance(router.address), 0);

        await expectRevert(piYfi.withdraw(ether(42), { from: alice }), 'FEE');

        const res = await piYfi.withdraw(ether(42), { from: alice, value: ethFee });
        expectEvent(res, 'Withdraw', {
          account: alice,
          underlyingWithdrawn: ether(42),
          piBurned: ether(42),
        });

        assert.equal(await yfi.balanceOf(alice), ether(10000));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(0));

        assert.equal(await piYfi.totalSupply(), ether(0));
        assert.equal(await piYfi.balanceOf(alice), ether(0));

        assert.equal(await web3.eth.getBalance(router.address), ethFee);
        assert.equal(await web3.eth.getBalance(piYfi.address), 0);
      });
    });

    describe('imbalanced wrapper', () => {
      beforeEach(async () => {
        assert.equal(await yfi.balanceOf(bob), ether(0));
      });

      it('should burn greater pi amount for a negatively imbalanced router', async () => {
        await yfi.approve(piYfi.address, ether(1200), { from: alice });
        await piYfi.deposit(ether(1200), { from: alice });
        // Drain 200 yfi from the wrapper token
        await router.drip(stub, ether(200));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(1000));
        assert.equal(await piYfi.totalSupply(), ether(1200));
        await piYfi.transfer(bob, ether(120), { from: alice });

        // Withdraw
        const res = await piYfi.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(120),
        });

        assert.equal(await yfi.balanceOf(bob), ether(100));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(900));

        assert.equal(await piYfi.totalSupply(), ether(1080));
        assert.equal(await piYfi.balanceOf(bob), ether(0));
      });

      it('should burn smaller pi amount for a positively imbalanced router', async () => {
        await yfi.approve(piYfi.address, ether(1000), { from: alice });
        await piYfi.deposit(ether(1000), { from: alice });
        await yfi.transfer(piYfi.address, ether(600), { from: alice });
        assert.equal(await yfi.balanceOf(piYfi.address), ether(1600));
        assert.equal(await piYfi.totalSupply(), ether(1000));
        await piYfi.transfer(bob, ether(62.5), { from: alice });

        // Withdraw
        const res = await piYfi.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(62.5),
        });

        assert.equal(await yfi.balanceOf(bob), ether(100));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(1500));

        assert.equal(await piYfi.totalSupply(), ether(937.5));
        assert.equal(await piYfi.balanceOf(bob), ether(0));
      });

      it('should allow draining a negatively imbalanced router', async () => {
        await yfi.approve(piYfi.address, ether(200), { from: alice });
        await piYfi.deposit(ether(200), { from: alice });
        await router.drip(stub, ether(100));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(100));
        assert.equal(await piYfi.totalSupply(), ether(200));

        await piYfi.transfer(bob, ether(200), { from: alice });

        // Withdraw
        const res = await piYfi.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(200),
        });

        assert.equal(await yfi.balanceOf(bob), ether(100));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(0));

        assert.equal(await piYfi.totalSupply(), ether(0));
        assert.equal(await piYfi.balanceOf(bob), ether(0));
      });

      it('should allow draining a positively imbalanced router', async () => {
        await yfi.approve(piYfi.address, ether(100), { from: alice });
        await piYfi.deposit(ether(100), { from: alice });
        await yfi.transfer(piYfi.address, ether(100), { from: alice });
        assert.equal(await yfi.balanceOf(piYfi.address), ether(200));
        assert.equal(await piYfi.totalSupply(), ether(100));
        await piYfi.transfer(bob, ether(100), { from: alice });

        // Withdraw
        const res = await piYfi.withdraw(ether(200), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(200),
          piBurned: ether(100),
        });

        assert.equal(await yfi.balanceOf(bob), ether(200));
        assert.equal(await yfi.balanceOf(piYfi.address), ether(0));

        assert.equal(await piYfi.totalSupply(), ether(0));
        assert.equal(await piYfi.balanceOf(bob), ether(0));
      });
    });
  });

  describe('router interface', async () => {
    describe('changeRouter', async () => {
      it('should allow changing a router', async () => {
        const data = await piYfi.contract.methods.changeRouter(alice).encodeABI();
        const res = await router.execute(piYfi.address, data);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'ChangeRouter', {
          newRouter: alice,
        });
        assert.equal(await piYfi.router(), alice);
      });

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piYfi.changeRouter(alice, { from: alice }), 'ONLY_ROUTER');
      });
    });

    describe('setEthFee', async () => {
      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piYfi.setEthFee(ether(0.1), { from: alice }), 'ONLY_ROUTER');
      });
    });

    describe('approveToken', async () => {
      it('should allow the router approving locked tokens', async () => {
        const data = await piYfi.contract.methods.approveUnderlying(bob, ether(55)).encodeABI();
        const res = await router.execute(piYfi.address, data);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'Approve', {
          to: bob,
          amount: ether(55),
        });
        assert.equal(await yfi.allowance(piYfi.address, bob), ether(55));
      });

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piYfi.approveUnderlying(alice, ether(33), { from: alice }), 'ONLY_ROUTER');
      });
    });

    describe('callVoting', async () => {
      let signature, args;
      beforeEach(async () => {
        const data = await router.contract.methods.piTokenCallback(ether(15)).encodeABI();
        ({ signature, args } = signatureAndArgs(data));
      });

      it('should allow the router calling any method on any contract', async () => {
        const data2 = await piYfi.contract.methods.callExternal(router.address, signature, args, 0).encodeABI();
        const res = await router.execute(piYfi.address, data2);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'CallExternal', {
          destination: router.address,
          inputSig: web3.utils.padRight(signature, 64),
          inputData: args,
        });

        await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
          withdrawAmount: ether(15),
        });
      });

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piYfi.callExternal(alice, signature, args, 0, { from: alice }), 'ONLY_ROUTER');

        await expectRevert(piYfi.callExternalMultiple([{
          destination: alice,
          signature: signature,
          args: args,
          value: 0,
        }], { from: alice }), 'ONLY_ROUTER');
      });
    });
  });
});
