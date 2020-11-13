// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "./ILpTokenMigrator.sol";

/**
 * @notice
 */
interface IVestedLPMining {
  /**
   * @notice Initializes the storage of the contract
   * @dev "constructor" to be called on a new proxy deployment
   * @dev Sets the contract `owner` account to the deploying account
   */
  function initialize(
    IERC20 _cvp,
    address _reservoir,
    uint256 _cvpPerBlock,
    uint256 _startBlock,
    uint256 _cvpVestingPeriodInBlocks
  ) external;

  function poolLength() external view returns (uint256);

  /// @notice Add a new pool (only the owner may call)
  function add(
    uint256 _allocPoint,
    IERC20 _lpToken,
    uint8 _poolType,
    bool _votesEnabled
  ) external;

  /// @notice Update parameters of the given pool (only the owner may call)
  function set(
    uint256 _pid,
    uint256 _allocPoint,
    uint8 _poolType,
    bool _votesEnabled
  ) external;

  /// @notice Set the migrator contract (only the owner may call)
  function setMigrator(ILpTokenMigrator _migrator) external;

  /// @notice Set CVP reward per block (only the owner may call)
  /// @dev Consider updating pool before calling this function
  function setCvpPerBlock(uint256 _cvpPerBlock) external;

  /// @notice Set CVP vesting period in blocks (only the owner may call)
  function setCvpVestingPeriodInBlocks(uint256 _cvpVestingPeriodInBlocks) external;

  /// @notice Migrate LP token to another LP contract
  function migrate(uint256 _pid) external;

  /// @notice Return reward multiplier over the given _from to _to block
  function getMultiplier(uint256 _from, uint256 _to) external pure returns (uint256);

  /// @notice Return the amount of pending CVPs entitled to the given user of the pool
  function pendingCvp(uint256 _pid, address _user) external view returns (uint256);

  /// @notice Return the amount of CVP tokens which may be vested to a user of a pool in the current block
  function vestableCvp(uint256 _pid, address user) external view returns (uint256);

  /// @notice Return `true` if the LP Token is added to created pools
  function isLpTokenAdded(IERC20 _lpToken) external view returns (bool);

  /// @notice Update reward computation params for all pools
  /// @dev Be careful of gas spending
  function massUpdatePools() external;

  /// @notice Update CVP tokens allocation for the given pool
  function updatePool(uint256 _pid) external;

  /// @notice Deposit the given amount of LP tokens to the given pool
  function deposit(uint256 _pid, uint256 _amount) external;

  /// @notice Withdraw the given amount of LP tokens from the given pool
  function withdraw(uint256 _pid, uint256 _amount) external;

  /// @notice Withdraw LP tokens without caring about pending CVP tokens. EMERGENCY ONLY.
  function emergencyWithdraw(uint256 _pid) external;

  /// @notice Write votes of the given user at the current block
  function checkpointVotes(address _user) external;

  /// @notice Get CVP amount and the share of CVPs in LP pools for the given account and the checkpoint
  function getCheckpoint(address account, uint32 checkpointId)
    external
    view
    returns (
      uint32 fromBlock,
      uint96 cvpAmount,
      uint96 pooledCvpShare
    );

  event AddLpToken(address indexed lpToken, uint256 indexed pid, uint256 allocPoint);
  event SetLpToken(address indexed lpToken, uint256 indexed pid, uint256 allocPoint);
  event SetMigrator(address indexed migrator);
  event SetCvpPerBlock(uint256 cvpPerBlock);
  event SetCvpVestingPeriodInBlocks(uint256 cvpVestingPeriodInBlocks);
  event MigrateLpToken(address indexed oldLpToken, address indexed newLpToken, uint256 indexed pid);

  event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
  event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
  event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);

  event CheckpointTotalLpVotes(uint256 lpVotes);
  event CheckpointUserLpVotes(address indexed user, uint256 indexed pid, uint256 lpVotes);
  event CheckpointUserVotes(address indexed user, uint256 pendedVotes, uint256 lpVotesShare);
}
