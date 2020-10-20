/* global after, afterEach, artifacts, before, beforeEach, contract, describe, it, web3 */
const MockDelegatableVotes = artifacts.require('MockDelegatableVotes');

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

    describe('Running pre-defined scenario', () => {
        before(async () => {
            this.dlgVotes = await MockDelegatableVotes.new();
            this.txs = [];
            /* 0*/ this.txs.push(await this.dlgVotes.__writeSharedData(1010));
            /* 1*/ this.txs.push(await this.dlgVotes.__writeUserData(alice, 500));
            /* 2*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(alice));
            /* 3*/ this.txs.push(await this.dlgVotes.__writeUserData(bob, 300));
            /* 4*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(bob));
            /* 5*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(alice));
            /* 6*/ this.txs.push(await this.dlgVotes.__writeSharedData(906));       // Sh 906
            /* 7*/ this.txs.push(await this.dlgVotes.__writeUserData(bob, 204));    // B 204
            /* 8*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(bob));
            /* 9*/ this.txs.push(await this.dlgVotes.__writeUserData(alice, 402));  // A 402
            /*10*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(alice));
            /*11*/ this.txs.push(await this.dlgVotes.__moveUserData(alice, alice, carol));
            /*12*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(alice));
            /*13*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(carol));
            /*14*/ this.txs.push(await this.dlgVotes.__moveUserData(bob, bob, carol));
            /*15*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(alice));
            /*16*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(bob));
            /*17*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(carol));
            /*18*/ this.txs.push(await this.dlgVotes.__writeSharedData(100));       // Sh 100
            // note: Carol returns Alice' voices but still retains Bob' voices
            /*19*/ this.txs.push(await this.dlgVotes.__moveUserData(alice, carol, alice));
            // note: Carol has no ("own") voices to move
            /*20*/ this.txs.push(await this.dlgVotes.__moveUserData(carol, carol, carl));
            /* note:
               `_moveUserData` moves ("own") voices but, unlike `delegate`, doesn't change the "delegatee".
               carol has delegated voices of bob, but she is not registered as bob' delegatee.
               with `delegate`, bob "double-spends" his voices moving them to alice w/o writing off from carol.
            */
            /*21*/ this.txs.push(await this.dlgVotes.delegate(alice, {from: bob}));
            /*22*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(alice));
            /*23*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(bob));
            /*24*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(carol));
            /*25*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(carl));
            /*26*/ this.txs.push(await this.dlgVotes.delegatee.call({from: alice}));
            /*27*/ this.txs.push(await this.dlgVotes.delegate(carl, {from: alice}));
            /*28*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(alice));
            /*29*/ this.txs.push(await this.dlgVotes.getCurrentVotes.call(carl));
            /*30*/ this.txs.push(await this.dlgVotes.delegatee.call({from: alice}));
            /*31*/ this.txs.push(await this.dlgVotes.delegatee.call({from: bob}));
            /*32*/ this.txs.push(await this.dlgVotes.delegatee.call({from: carol}));
            /*33*/ this.txs.push(await this.dlgVotes.delegatee.call({from: carl}));
        });

        it('should return expected votes on tx 2', async () => {
            assert.equal(this.txs[2].toString(), '1510');
        });

        it('should return expected votes on tx #4 and #5', async () => {
            assert.equal(this.txs[4].toString(), '1310');
            assert.equal(this.txs[5].toString(), '1510');
        });

        it('should return expected votes on tx #8', async () => {
            assert.equal(this.txs[8].toString(), '1110');
        });

        it('should return expected votes on tx #10', async () => {
            assert.equal(this.txs[10].toString(), '1308');
        });

        it('should return expected votes on txs #12,#13', async () => {
            assert.equal(this.txs[12].toString(), '0');
            assert.equal(this.txs[13].toString(), '1308');
        });

        it('should return expected votes on txs #15,#16,#17', async () => {
            assert.equal(this.txs[15].toString(), '0');
            assert.equal(this.txs[16].toString(), '0');
            assert.equal(this.txs[17].toString(), '1512');
        });

        it('should return expected votes on txs #22..#25', async () => {
            assert.equal(this.txs[22].toString(), '706');
            assert.equal(this.txs[23].toString(), '0');
            assert.equal(this.txs[24].toString(), '304');
            assert.equal(this.txs[25].toString(), '0');
        });

        it('should return expected delegatee on tx #26', async () => {
            assert.equal(this.txs[26].toString(), '0x0000000000000000000000000000000000000000');
        });

        it('should return expected votes on txs #28,#29', async () => {
            assert.equal(this.txs[28].toString(), '304');
            assert.equal(this.txs[29].toString(), '502');
        });

        it('should return expected delegatee on txs #30..33', async () => {
            assert.equal(this.txs[30].toString(), carl);
            assert.equal(this.txs[31].toString(), alice);
            assert.equal(this.txs[32].toString(), '0x0000000000000000000000000000000000000000');
            assert.equal(this.txs[33].toString(), '0x0000000000000000000000000000000000000000');
        });

        context('`getPriorVotes` called afterwords', () => {
            it('should return expected voices for the block of tx #11', async () => {
                const blockNum = this.txs[11].receipt.blockNumber;
                assert.equal((await this.dlgVotes.getPriorVotes.call(alice, blockNum)).toString(), '0');
                assert.equal((await this.dlgVotes.getPriorVotes.call(carol, blockNum)).toString(), '1308');
            });

            it('should return expected voices for the block of tx #14', async () => {
                const blockNum = this.txs[14].receipt.blockNumber;
                assert.equal((await this.dlgVotes.getPriorVotes.call(alice, blockNum)).toString(), '0');
                assert.equal((await this.dlgVotes.getPriorVotes.call(bob, blockNum)).toString(), '0');
                assert.equal((await this.dlgVotes.getPriorVotes.call(carol, blockNum)).toString(), '1512');
            });

            it('should return expected voices for the block of tx #21', async () => {
                const blockNum = this.txs[21].receipt.blockNumber;
                assert.equal((await this.dlgVotes.getPriorVotes.call(alice, blockNum)).toString(), '706');
                assert.equal((await this.dlgVotes.getPriorVotes.call(bob, blockNum)).toString(), '0');
                assert.equal((await this.dlgVotes.getPriorVotes.call(carol, blockNum)).toString(), '304');
                assert.equal((await this.dlgVotes.getPriorVotes.call(carl, blockNum)).toString(), '0');
            });
        });
    });
});
