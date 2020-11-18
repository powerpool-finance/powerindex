// Based on https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/test/math/SafeMath.test.js
const MockSafeMath96 = artifacts.require('MockSafeMath96');
const { BN, expectRevert } = require('@openzeppelin/test-helpers');
const MAX_UINT96 = new BN('2').pow(new BN('96')).sub(new BN('1'));

const { expect } = require('chai');

contract('safeMath96', function () {
    beforeEach(async function () {
        this.safeMath96 = await MockSafeMath96.new();
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

            await testCommutative(this.safeMath96.add, a, b, a.add(b));
        });

        it('reverts on addition overflow', async function () {
            const a = MAX_UINT96;
            const b = new BN('1');

            await testFailsCommutative(this.safeMath96.add, a, b, 'SafeMath96: addition overflow');
        });
    });

    describe('sub', function () {
        it('subtracts correctly', async function () {
            const a = new BN('5678');
            const b = new BN('1234');

            expect(await this.safeMath96.sub(a, b)).to.be.bignumber.equal(a.sub(b));
        });

        it('reverts if subtraction result would be negative', async function () {
            const a = new BN('1234');
            const b = new BN('5678');

            await expectRevert(this.safeMath96.sub(a, b), 'SafeMath96: subtraction overflow');
        });
    });

    describe('average', function () {
        it('compute the average correctly', async function () {
            const a = new BN('1234');
            const b = new BN('5678');

            await testCommutative(this.safeMath96.average, a, b, a.add(b).div(new BN('2')));
        });

        it('process zero correctly', async function () {
            const a = new BN('0');
            const b = new BN('5678');

            await testCommutative(this.safeMath96.average, a, b, b.div(new BN('2')));
        });

        it('process MAX_UINT96 correctly', async function () {
            const a = MAX_UINT96;
            const b = new BN('2');

            await testCommutative(this.safeMath96.average, a, b, a.add(b).div(new BN('2')));
        });
    });

    describe('fromUint', function () {
        it('returns MAX_UINT96 if MAX_UINT96 given', async function () {
            const a = MAX_UINT96;

            expect(await this.safeMath96.fromUint(a)).to.be.bignumber.equal(a);
        });

        it('returns zero if zero given', async function () {
            const a = new BN('0');

            expect(await this.safeMath96.fromUint(a)).to.be.bignumber.equal('0');
        });

        it('reverts on a number exceeding MAX_UINT96', async function () {
            const a = MAX_UINT96.add(new BN('1'));
            await expectRevert(this.safeMath96.fromUint(a), 'SafeMath96: exceeds 96 bits');
        });
    });
});
