pragma solidity 0.6.12;

library CachedCheckpoints {

    /// @notice A checkpoint storing some data effective from a given block
    struct Checkpoint {
        uint32 fromBlock;
        uint32 __reserved;
        uint192 data;
    }

    /// @notice Params of an account' checkpoints and some cached arbitrary data
    struct Cache {
        uint32 numCheckpoints;
        uint32 lastCheckpointBlock;
        // cached data (but NOT the last checkpoint data)
        uint192 data;
    }

    /// @notice Checkpoints for each account, by index
    mapping (address => mapping (uint32 => Checkpoint)) public checkpoints;

    /// @notice Cache for each account
    mapping (address => Cache) public cache;

    /// @dev The exact copy from CVP token
    /**
     * @dev Gets the latest data recorded for `account`
     * @param account The address to get the data for
     * @return The latest data recorded
     */
    function _getLatestData(address account) internal view returns (uint192) {
        uint32 nCheckpoints = cache[account].numCheckpoints;
        return nCheckpoints == 0 ? 0 : checkpoints[account][nCheckpoints - 1].data;
    }

    /**
     * @dev Determine the prior data recorded for an account as of a block number
     * (reverts if the requested block has not been finalized)
     * @param account The address of the account to check
     * @param blockNumber The block number to get the data at
     * @param checkpointNumber Optional checkpoint number, counted from 1, to first look data in
     * @return The data the account had as of the given block
     */
    function _getPriorData(address account, uint blockNumber, uint checkpointNumber) public view returns (uint192) {
        require(blockNumber < block.number, "ChPoints: block not yet mined");
        uint32 blockNum = _safeBlockNum(blockNumber);
        Cache memory cached = cache[account];
        Checkpoint memory cp;

        // First check specific checkpoint, if it's provided
        if (checkpointNumber != 0) {
            require(checkpointNumber <= cached.numCheckpoints, "ChPoints: invalid checkpoint num");
            uint32 cpNum = uint32(checkpointNumber);

            cp = checkpoints[account][cpNum - 1];
            if (cp.fromBlock == blockNum) {
                return cp.data;
            } else if (cp.fromBlock < blockNum) {
                if (cpNum == cached.numCheckpoints) {
                    return cp.data;
                }
                cp = checkpoints[account][cpNum];
                if (cp.fromBlock >= blockNum) {
                    return cp.data;
                }
            }
        }

        // Then check special cases
        if (cached.numCheckpoints == 0) {
            return 0;
        }
        if (cached.lastCheckpointBlock <= blockNum) {
            return checkpoints[account][cached.numCheckpoints - 1].data;
        }
        if (checkpoints[account][0].fromBlock > blockNum) {
            return 0;
        }

        // Finally, search trough all checkpoints
        uint32 lower = 0;
        uint32 upper = cached.numCheckpoints - 1;
        while (upper > lower) {
            uint32 center = upper - (upper - lower) / 2; // ceil, avoiding overflow
            cp = checkpoints[account][center];
            if (cp.fromBlock == blockNum) {
                return cp.data;
            } else if (cp.fromBlock < blockNum) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return checkpoints[account][lower].data;
    }

    /**
     * @dev Write data for an account as of a block number
     * @param account The address of the account to check
     * @param data The data the account has as of the current block
     */
    function _writeCheckpoint(address account, uint192 data) internal {
        uint32 blockNum = _safeBlockNum(block.number);
        Cache memory cached = cache[account];

        if (cached.lastCheckpointBlock == blockNum) {
            checkpoints[account][cached.numCheckpoints - 1].data = data;
        } else {
            checkpoints[account][cached.numCheckpoints] = Checkpoint(blockNum, data);
            cached.numCheckpoints = cached.numCheckpoints + 1; // overflow chance ignored
            cached.lastCheckpointBlock = blockNum;
        }
        cache[account] = cached;
    }

    function _setCacheData(address account) internal view returns (uint192) {
        return cache[account].data;
    }

    function _getCacheData(address account, uint192 data) internal {
        return cache[account].data = data;
    }

    /// @dev The exact copy from CVP token
    function safe32(uint n, string memory errorMessage) internal pure returns (uint32) {
        require(n < 2**32, errorMessage);
        return uint32(n);
    }

    /// @dev The exact copy from CVP token
    function safe96(uint n, string memory errorMessage) internal pure returns (uint96) {
        require(n < 2**96, errorMessage);
        return uint96(n);
    }

    /// @dev The exact copy from CVP token
    function add96(uint96 a, uint96 b, string memory errorMessage) internal pure returns (uint96) {
        uint96 c = a + b;
        require(c >= a, errorMessage);
        return c;
    }

    /// @dev The exact copy from CVP token
    function sub96(uint96 a, uint96 b, string memory errorMessage) internal pure returns (uint96) {
        require(b <= a, errorMessage);
        return a - b;
    }

    function _safeBlockNum(uint256 blockNumber) private pure returns (uint32) {
        return safe32(block.number, "ChPoints: block number exceeds 32 bits");
    }
}
