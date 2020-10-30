
pragma solidity 0.6.12;

interface YearnGovernanceInterface {
    function stake(uint256 amount) external virtual;

    function withdraw(uint256 amount) external virtual;

    function voteFor(uint id) external virtual;

    function voteAgainst(uint id) external virtual;

    function balanceOf(address) external view virtual returns (uint);

    function voteLock(address) external view virtual returns (uint);
}