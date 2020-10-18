pragma solidity ^0.6.12;


import "../lib/CacheCheckpoints.sol";

contract MockCacheCheckpoint {
    using CacheCheckpoints for CacheCheckpoints.Record;

    mapping (address => CacheCheckpoints.Record) public records;

    function getLatestData(address user) public view returns (uint192) {
        return records[user].getLatestData();
    }

    function getPriorData(address user, uint blockNumber, uint checkpointId) public view returns (uint192) {
        return records[user].getPriorData(blockNumber, checkpointId);
    }

    function findCheckpoint(address user, uint blockNumber) public view returns (uint32 id, uint192 data) {
        (id, data) = records[user].findCheckpoint(blockNumber);
    }

    event DEBUG32(uint32);
    function writeCheckpoint(address user, uint192 data) public returns (uint32 id) {
        id = records[user].writeCheckpoint(data);
        emit DEBUG32(id);
    }

    function getCache(address user) public view returns (uint192) {
        return records[user].getCache();
    }

    function writeCache(address user, uint192 data) public {
        records[user].writeCache(data);
    }
}
