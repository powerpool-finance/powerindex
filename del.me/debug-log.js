// ***DEBUG
const { appendFileSync } = require('fs');
const DEBUG_LOG = (msg) => appendFileSync('.debug-log.txt', `*** DEBUG (${(new Date()).toLocaleTimeString()}): ${msg}\n`);
const T_STR = (t) => (new Date(1000*t)).toLocaleTimeString()
const LOG_TIMESTAMP = async (msg) => { let block = await web3.eth.getBlock("latest"); DEBUG_LOG(`${msg}: Block: ${block.number}, Timestamp: ${T_STR(block.timestamp)}`); }

if (module) module.exports = {
    DEBUG_LOG,
    LOG_TIMESTAMP
}
