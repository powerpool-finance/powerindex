// Based on https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/test/math/SafeMath.test.js
const MockSafeMath32 = artifacts.require('MockSafeMath32');
const { BN, expectRevert } = require('@openzeppelin/test-helpers');
const MAX_UINT32 = new BN('2').pow(new BN('32')).sub(new BN('1'));

const { expect } = require('chai');

contract('safeMath32', function () {
    beforeEach(async function () {
        this.safeMath32 = await MockSafeMath32.new();
    });

    async function testCommutative (fn, lhs, rhs, expected) {
        expect(await fn(lhs, rhs)).to.be.bignumber.equal(expected);
        expect(await fn(rhs, lhs)).to.be.bignumber.equal(expected);
    }

    async function testFailsCommutative (fn, lhs, rhs, reason) {
        await expectRevert(fn(lhs, rhs), reason);
        await expectRevert(fn(rhs, lhs), reason);
    }

    describe('add', function () {
        it('adds correctly', async function () {
            const a = new BN('5678');
            const b = new BN('1234');

            await testCommutative(this.safeMath32.add, a, b, a.add(b));
        });

        it('reverts on addition overflow', async function () {
            const a = MAX_UINT32;
            const b = new BN('1');

            await testFailsCommutative(this.safeMath32.add, a, b, 'SafeMath32: addition overflow');
        });
    });

    describe('sub', function () {
        it('subtracts correctly', async function () {
            const a = new BN('5678');
            const b = new BN('1234');

            expect(await this.safeMath32.sub(a, b)).to.be.bignumber.equal(a.sub(b));
        });

        it('reverts if subtraction result would be negative', async function () {
            const a = new BN('1234');
            const b = new BN('5678');

            await expectRevert(this.safeMath32.sub(a, b), 'SafeMath32: subtraction overflow');
        });
    });

    describe('fromUint', function () {
        it('returns MAX_UINT32 if MAX_UINT32 given', async function () {
            const a = MAX_UINT32;

            expect(await this.safeMath32.fromUint(a)).to.be.bignumber.equal(a);
        });

        it('returns zero if zero given', async function () {
            const a = new BN('0');

            expect(await this.safeMath32.fromUint(a)).to.be.bignumber.equal('0');
        });

        it('reverts on a number exceeding MAX_UINT32', async function () {
            const a = MAX_UINT32.add(new BN('1'));
            await expectRevert(this.safeMath32.fromUint(a), 'SafeMath32: exceeds 32 bits');
        });
    });
});
