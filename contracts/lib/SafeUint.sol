pragma solidity 0.6.12;

library SafeUint {

    function safe32(uint n, string memory errorMessage) internal pure returns (uint32) {
        require(n < 2**32, errorMessage);
        return uint32(n);
    }

    function safe96(uint n, string memory errorMessage) internal pure returns (uint96) {
        require(n < 2**96, errorMessage);
        return uint96(n);
    }

    function add96(uint96 a, uint96 b, string memory errorMessage) internal pure returns (uint96) {
        uint96 c = a + b;
        require(c >= a, errorMessage);
        return c;
    }

    function sub96(uint96 a, uint96 b, string memory errorMessage) internal pure returns (uint96) {
        require(b <= a, errorMessage);
        return a - b;
    }

    function safeBlockNum(uint256 blockNumber) internal pure returns (uint32) {
        return safe32(blockNumber, "SafeUint: block number exceeds 32 bits");
    }

    function safeMinedBlockNum(uint256 blockNumber) internal view returns (uint32) {
        require(blockNumber < block.number, "SafeUint: block not yet mined");
        return safeBlockNum(blockNumber);
    }
}
