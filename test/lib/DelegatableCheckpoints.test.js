const MockCacheCheckpoint = artifacts.require('MockDelegatableCheckpoints');

const str = (bn) => bn.toString(10);

contract('DelegatableCheckpoints lib', ([ , accountA, accountB, delegateeC, delegateeD , delegateeE]) => {

    before(async () => {
        this.records = await MockCacheCheckpoint.new();
        const txs = Array(
            /* 0*/ await this.records.getProperties(accountA),
            /* 1*/ await this.records.writeDelegatee(accountA, delegateeC),
            /* 2*/ await this.records.getProperties(accountA),
            /* 3*/ await web3.eth.getBlockNumber(),
            /* 4*/ await this.records.writeCheckpoint(accountB, 101),
            /* 5*/ await this.records.getLatestData(accountB),
            /* 6*/ await this.records.writeDelegatee(accountB, delegateeD),
            /* 7*/ await this.records.writeCheckpoint(accountB, 103),
            /* 8*/ await this.records.writeCheckpoint(accountB, 104),
            /* 9*/ await this.records.writeCheckpoint(accountB, 105),
            /*10*/ await this.records.writeDelegatee(accountA, delegateeE),
            /*11*/ await this.records.writeCheckpoint(accountB, 107),
            /*12*/ await this.records.writeCheckpoint(accountA, 108),
            /*13*/ await this.records.getLatestData(accountB),
            /*14*/ await this.records.getLatestData(accountA),
            /*15*/ await this.records.writeCheckpoint(accountB, 109),
            /*16*/ await this.records.writeDelegatee(accountB, delegateeC),
            /*17*/ await this.records.writeDelegatee(accountB, delegateeE),
            /*18*/ await this.records.writeDelegatee(accountB, delegateeD),
            /*19*/ await this.records.writeCheckpoint(accountA, 113),
            /*20*/ await this.records.getProperties(accountA),
            /*21*/ await this.records.getProperties(accountB),
        );
        const results = [];
        // Run one by one
        txs.reduce(
            async (promiseChain, tx) => promiseChain.then(results.push(await tx)),
            Promise.resolve(),
        );
        this.results = results;
    });

    describe('`getProperties` function', () => {
        it('should return the "numCheckpoints" property', () => {
            assert.strictEqual(typeof this.results[0].numCheckpoints, 'object');
            assert.strictEqual(typeof this.results[0].lastCheckpointBlock, 'object');
            assert.strictEqual(typeof this.results[0].delegatee, 'string');
        });

        it('should return the "lastCheckpointBlock" property', () => {
            assert.strictEqual(typeof this.results[0].numCheckpoints, 'object');
            assert.strictEqual(typeof this.results[0].lastCheckpointBlock, 'object');
            assert.strictEqual(typeof this.results[0].delegatee, 'string');
        });

        it('should return the "delegatee" property', () => {
            assert.strictEqual(typeof this.results[0].numCheckpoints, 'object');
            assert.strictEqual(typeof this.results[0].lastCheckpointBlock, 'object');
            assert.strictEqual(typeof this.results[0].delegatee, 'string');
        });

        it('should return zero values if no data has been recorded yet', () => {
            assert.strictEqual(str(this.results[0].numCheckpoints), '0');
            assert.strictEqual(str(this.results[0].lastCheckpointBlock), '0');
        });

        it('should return a number of checkpoints written', () => {
            assert.strictEqual(str(this.results[21].numCheckpoints), '6');
        });

        it('should return the latest recorded delegatee', () => {
            assert.strictEqual(str(this.results[20].delegatee), delegateeE);
            assert.strictEqual(str(this.results[21].delegatee), delegateeD);
        });
    });

    describe('`writeDelegatee` function', () => {
        it('should rewrite delegatee', () => {
            assert.strictEqual(str(this.results[2].delegatee), delegateeC);
            assert.strictEqual(str(this.results[21].delegatee), delegateeD);
        });
    });

    describe('`writeCheckpoint` function', () => {
        it('should return checkpoint id being 1 for the 1st checkpoint', () => {
            assert.strictEqual(str(this.results[4].logs[0].args[0].toString()), '1');
        });

        describe('being called several times', () => {
            it('should return incremental checkpoint id for the same account', () => {
                assert.strictEqual(str(this.results[7].logs[0].args[0].toString()), '2');
                assert.strictEqual(str(this.results[8].logs[0].args[0].toString()), '3');
                assert.strictEqual(str(this.results[9].logs[0].args[0].toString()), '4');
                assert.strictEqual(str(this.results[11].logs[0].args[0].toString()), '5');
                assert.strictEqual(str(this.results[15].logs[0].args[0].toString()), '6');
            });
        });

        describe('`getLatestData` function', () => {
            it('should return latest check-pointed data', () => {
                assert.strictEqual(str(this.results[5]), '101');
                assert.strictEqual(str(this.results[13]), '107');
                assert.strictEqual(str(this.results[14]), '108');
            });
        });

        describe('`getPriorData` function', () => {

            describe('with a valid checkpoint ID provided on call', () => {
                it('should return data check-pointed at the requested block', async () => {
                    let blockNum = this.results[4].receipt.blockNumber;
                    let act = await this.records.getPriorData(accountB, blockNum, '1');
                    assert.strictEqual(str(act), '101');
                });

                it('should return data check-pointed before the requested block', async () => {
                    let blockNum = this.results[17].receipt.blockNumber;
                    let act = await this.records.getPriorData(accountA, blockNum, '1');
                    assert.strictEqual(str(act), '108');
                });
            });

            describe('with inacurate checkpoint ID provided on call', () => {
                it('should still return data check-pointed at the requested block', async () => {
                    let blockNum = this.results[4].receipt.blockNumber;
                    let act = await this.records.getPriorData(accountB, blockNum, '2');
                    assert.strictEqual(str(act), '101');
                });

                it('should still return data check-pointed before the requested block', async () => {
                    let blockNum = this.results[16].receipt.blockNumber;
                    let act = await this.records.getPriorData(accountB, blockNum, '2');
                    assert.strictEqual(str(act), '109');
                });
            });

            describe('w/o a valid checkpoint ID invoked with', () => {
                it('should return data check-pointed at the requested block', async () => {
                    let blockNum = this.results[4].receipt.blockNumber;
                    let act = await this.records.getPriorData(accountB, blockNum, '0');
                    assert.strictEqual(str(act), '101');
                });

                it('should return data check-pointed before the requested block', async () => {
                    let blockNum = this.results[10].receipt.blockNumber;
                    let act = await this.records.getPriorData(accountB, blockNum, '0');
                    assert.strictEqual(str(act), '105');
                });

                it('should return data check-pointed long before the requested block', async () => {
                    let blockNum = this.results[18].receipt.blockNumber;
                    let act = await this.records.getPriorData(accountA, blockNum, '0');
                    assert.strictEqual(str(act), '108');
                });
            });

        });

        describe('`findCheckpoint` function', () => {
            it('should return checkpoint id and data', async () => {
                let blockNum = this.results[15].receipt.blockNumber - 1;
                let act = await this.records.findCheckpoint(accountB, blockNum);
                assert.strictEqual(str(act.id), '5');
                assert.strictEqual(str(act.data), '107');
            });

            it('should return zeros for non-existing checkpoint', async () => {
                let blockNum = this.results[11].receipt.blockNumber;
                let act = await this.records.findCheckpoint(accountA, blockNum);
                assert.strictEqual(str(act.id), '0');
                assert.strictEqual(str(act.data), '0');
            });
        });
    });
});
