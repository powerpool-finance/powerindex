// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


library DelegatableCheckpoints {

    /// @dev A checkpoint storing some data effective from a given block
    struct Checkpoint {
        uint32 fromBlock;
        uint192 data;
        // uint32 __reserved;
    }

    /// @dev A set of checkpoints and a 'delegatee'
    struct Record {
        /// new slot
        uint32 numCheckpoints;
        uint32 lastCheckpointBlock;
        address delegatee;
        // uint32 __reserved;

        /// new slot
        // Checkpoints by IDs
        mapping (uint32 => Checkpoint) checkpoints;
        // @dev Checkpoint IDs get counted from 1 (but not from 0) -
        // the 1st checkpoint has ID of 1, and the last checkpoint' ID is `numCheckpoints`
    }

    function getCheckpoint(Record storage record, uint checkpointId)
    internal view returns (uint32 fromBlock, uint192 data)
    {
        return checkpointId == 0 || checkpointId > record.numCheckpoints
            ? (0, 0)
            : _getCheckpoint(record, uint32(checkpointId));
    }

    function _getCheckpoint(Record storage record, uint32 checkpointId)
    internal view returns (uint32 fromBlock, uint192 data)
    {
        return (record.checkpoints[checkpointId].fromBlock, record.checkpoints[checkpointId].data);
    }

    /**
     * @dev Gets the data recorded in the latest checkpoint of the given record
     */
    function getLatestData(Record storage record)
    internal view returns (uint192)
    {
        Record memory _record = record;
        return _record.numCheckpoints == 0
        ? 0
        : record.checkpoints[_record.numCheckpoints].data;
    }

    /**
     * @dev Returns the prior data written in the given record' checkpoints as of a block number
     * (reverts if the requested block has not been finalized)
     * @param record The record with checkpoints
     * @param blockNumber The block number to get the data at
     * @param checkpointId Optional ID of a checkpoint to first look into
     * @return The data effective as of the given block
     */
    function getPriorData(Record storage record, uint blockNumber, uint checkpointId)
    internal view returns (uint192)
    {
        uint32 blockNum = _safeMinedBlockNum(blockNumber);
        Record memory _record = record;
        Checkpoint memory cp;

        // First check specific checkpoint, if it's provided
        if (checkpointId != 0) {
            require(checkpointId <= _record.numCheckpoints, "ChPoints: invalid checkpoint id");
            uint32 cpId = uint32(checkpointId);

            cp = record.checkpoints[cpId];
            if (cp.fromBlock == blockNum) {
                return cp.data;
            } else if (cp.fromBlock < blockNum) {
                if (cpId == _record.numCheckpoints) {
                    return cp.data;
                }
                uint32 nextFromBlock = record.checkpoints[cpId + 1].fromBlock;
                if (nextFromBlock > blockNum) {
                    return cp.data;
                }
            }
        }

        // Finally, search trough all checkpoints
        ( , uint192 data) = _findCheckpoint(record, _record.numCheckpoints, blockNum);
        return data;
    }

    /**
     * @dev Finds a checkpoint in the given record for the given block number
     * (reverts if the requested block has not been finalized)
     * @param record The record with checkpoints
     * @param blockNumber The block number to get the checkpoint at
     * @return id The checkpoint ID
     * @return data The checkpoint data
     */
    function findCheckpoint(Record storage record, uint blockNumber)
    internal view returns (uint32 id, uint192 data)
    {
        uint32 blockNum = _safeMinedBlockNum(blockNumber);
        uint32 numCheckpoints = record.numCheckpoints;

        (id, data) = _findCheckpoint(record, numCheckpoints, blockNum);
    }

    /**
     * @dev Writes a checkpoint with given data to the given record and returns the checkpoint ID
     */
    function writeCheckpoint(Record storage record, uint192 data)
    internal returns (uint32 id)
    {
        uint32 blockNum = _safeBlockNum(block.number);
        Record memory _record = record;

        uint192 oldData = _record.numCheckpoints > 0 ? record.checkpoints[_record.numCheckpoints].data : 0;
        bool isChanged = data != oldData;

        if (_record.lastCheckpointBlock != blockNum) {
            _record.numCheckpoints = _record.numCheckpoints + 1; // overflow chance ignored
            record.numCheckpoints = _record.numCheckpoints;
            record.lastCheckpointBlock = blockNum;
            isChanged = true;
        }
        if (isChanged) {
            record.checkpoints[_record.numCheckpoints] = Checkpoint(blockNum, data);
        }
        id = _record.numCheckpoints;
    }

    /**
     * @dev Gets the given record properties (w/o mappings)
     */
    function getProperties(Record storage record) internal view returns (uint32, uint32, address) {
        return (record.numCheckpoints, record.lastCheckpointBlock, record.delegatee);
    }

    /**
     * @dev Writes given delegatee to the given record
     */
    function writeDelegatee(Record storage record, address delegatee) internal {
        record.delegatee = delegatee;
    }

    function _safeBlockNum(uint256 blockNumber) private pure returns (uint32) {
        require(blockNumber < 2**32, "ChPoints: blockNum >= 2**32");
        return uint32(blockNumber);
    }

    function _safeMinedBlockNum(uint256 blockNumber) private view returns (uint32) {
        require(blockNumber < block.number, "ChPoints: block not yet mined");
        return _safeBlockNum(blockNumber);
    }

    function _findCheckpoint(Record storage record, uint32 numCheckpoints, uint32 blockNum)
    private view returns (uint32, uint192)
    {
        Checkpoint memory cp;

        // Check special cases first
        if (numCheckpoints == 0) {
            return (0, 0);
        }
        cp = record.checkpoints[numCheckpoints];
        if (cp.fromBlock <= blockNum) {
            return (numCheckpoints, cp.data);
        }
        if (record.checkpoints[1].fromBlock > blockNum) {
            return (0, 0);
        }

        uint32 lower = 1;
        uint32 upper = numCheckpoints;
        while (upper > lower) {
            uint32 center = upper - (upper - lower) / 2; // ceil, avoiding overflow
            cp = record.checkpoints[center];
            if (cp.fromBlock == blockNum) {
                return (center, cp.data);
            } else if (cp.fromBlock < blockNum) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return (lower, record.checkpoints[lower].data);
    }
}
