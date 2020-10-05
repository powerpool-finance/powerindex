/* global module, web3 */
const getCounter = ((n) => () => n++)(1);

module.exports = {
    createSnapshot,
    revertToSnapshot,
};

async function createSnapshot () {
    return new Promise((resolve, reject) =>  {
        web3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'evm_snapshot',
            params: [],
            id: getCounter(),
        }, async (err, res) => {
            if (err) {
                return reject(err);
            }
            if ( res.result === false ) {
                return reject(new Error(`failed to create a snapshot: ${JSON.stringify(res)}`));
            }
            return resolve(res.result);
        });
    });
}

async function revertToSnapshot (snapshot) {
    return new Promise((resolve, reject) =>  {
        web3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'evm_revert',
            params: [snapshot],
            id: getCounter(),
        }, async (err, res) => {
            if (err) {
                return reject(err);
            }
            if ( res.result === false ) {
                return reject(new Error(`failed to revert to the snapshot: ${JSON.stringify(res)}`));
            }
            return resolve(res);
        });
    });
}
