/* global after, afterEach, artifacts, before, beforeEach, contract, describe, it, web3 */
const { expectRevert, time } = require('@openzeppelin/test-helpers');
const { createSnapshot, revertToSnapshot } = require('./helpers/blockchain');
const MockDelegatableVotes = artifacts.require('MockDelegatableVotes');

const {toBN} = web3.utils;

contract('DelegatableVotes', ([ , alice, bob, carol, carl ]) => {

    describe('`getCurrentVotes`', () => {
        before(async () => {
            this.dlgVotes = await MockDelegatableVotes.new();
        });

        it('should return zero if no checkpoints have been written', async () => {
            const res = await this.dlgVotes.getCurrentVotes(alice);
            assert.equal(res.toString(), '0');
        });

        it('should return the only checkpoint value', async () => {
            await this.dlgVotes.__writeUserData(alice, 358);

            const res = await this.dlgVotes.getCurrentVotes(alice);
            assert.equal(res.toString(), '358');
        });

        it('should return the latest checkpoint value', async () => {
            await this.dlgVotes.__writeUserData(alice, 358);
            await this.dlgVotes.__writeUserData(alice, 359);
            await this.dlgVotes.__writeUserData(alice, 360);

            const res = await this.dlgVotes.getCurrentVotes(alice);
            assert.equal(res.toString(), '360');
        });

        it('should return value for a user given', async () => {
            await this.dlgVotes.__writeUserData(alice, 58);
            await this.dlgVotes.__writeUserData(bob, 39);

            assert.equal((await this.dlgVotes.getCurrentVotes(alice)).toString(), '58');
            assert.equal((await this.dlgVotes.getCurrentVotes(bob)).toString(), '39');
        });
    });

    describe('`getPriorVotes`', () => {

    });

    describe('`getPriorVotes` extended version', () => {

    });

    describe('`findCheckpoints`', () => {

    });

    describe('`_writeSharedData`', () => {

    });

    describe('`_writeUserData`', () => {

    });

    describe('`_moveUserData`', () => {

    });
});
