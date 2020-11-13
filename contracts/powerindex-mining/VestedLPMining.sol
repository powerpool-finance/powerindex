// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IVestedLPMining.sol";
import "../lib/ReservedSlots.sol";
import "../lib/SafeMath96.sol";
import "../lib/SafeMath32.sol";
import "./DelegatableVotes.sol";

contract VestedLPMining is
  OwnableUpgradeSafe,
  ReentrancyGuardUpgradeSafe,
  ReservedSlots,
  DelegatableVotes,
  IVestedLPMining
{
  using SafeMath for uint256;
  using SafeMath96 for uint96;
  using SafeMath32 for uint32;

  using SafeERC20 for IERC20;

  /// @dev properties grouped to optimize storage costs

  struct User {
    /// @dev new slot
    uint32 lastUpdateBlock; // block when the params (below) were updated
    uint32 vestingBlock; // block by when all entitled CVP tokens to be vested
    uint96 pendedCvp; // amount of CVPs tokens entitled but not yet vested to the user
    uint96 cvpAdjust; // adjustments for pended CVP tokens amount computation
    // (with regard to LP token deposits/withdrawals in the past)
    /// @dev new slot
    uint256 lptAmount; // amount of LP tokens the user has provided to a pool
    /** @dev
     * At any time, the amount of CVP tokens entitled to a user but not yet vested is the sum of:
     * (1) CVP token amount entitled after the user last time deposited or withdrawn LP tokens
     *     = (user.lptAmount * pool.accCvpPerLpt) - user.cvpAdjust
     * (2) CVP token amount entitled before the last deposit or withdrawal but not yet vested
     *     = user.pendedCvp
     *
     * Whenever a user deposits or withdraws LP tokens to a pool:
     *   1. `pool.accCvpPerLpt` for the pool gets updated;
     *   2. CVP token amounts to be entitled and vested to the user get computed;
     *   3. Token amount which may be vested get sent to the user;
     *   3. User' `lptAmount`, `cvpAdjust` and `pendedCvp` get updated.
     *
     * Note comments on vesting rules in the `function _computeCvpVesting` code bellow.
     */
  }

  struct Pool {
    /// @dev new slot
    IERC20 lpToken; // address of the LP token contract
    bool votesEnabled; // if the pool is enabled to write votes
    uint8 poolType; // pool type (1 - Uniswap, 2 - Balancer)
    uint32 allocPoint; // points assigned to the pool, which affect CVPs distribution between pools
    uint32 lastUpdateBlock; // latest block when the pool params which follow was updated
    /// @dev new slot
    uint256 accCvpPerLpt; // accumulated distributed CVPs per one deposited LP token, times 1e12
  }
  // scale factor for `accCvpPerLpt`
  uint256 internal constant SCALE = 1e12;

  /// @dev new slot
  // The CVP TOKEN
  IERC20 public cvp;
  // Total amount of CVP tokens pended (not yet vested to users)
  uint96 public cvpVestingPool;

  /// @dev new slot
  // Reservoir address
  address public reservoir;
  // Vesting duration in blocks
  uint32 public cvpVestingPeriodInBlocks;
  // The block number when CVP powerindex-mining starts
  uint32 public startBlock;
  // The amount of CVP tokens rewarded to all pools every block
  uint96 public cvpPerBlock;

  /// @dev new slot
  // The migrator contract (only the owner may assign it)
  ILpTokenMigrator public migrator;

  // Params of each pool
  Pool[] public pools;
  // Pid (i.e. the index in `pools`) of each pool by its LP token address
  mapping(address => uint256) public poolPidByAddress;
  // Params of each user that stakes LP tokens, by the Pid and the user address
  mapping(uint256 => mapping(address => User)) public users;
  // Sum of allocation points for all pools
  uint256 public totalAllocPoint = 0;

  /// @inheritdoc IVestedLPMining
  function initialize(
    IERC20 _cvp,
    address _reservoir,
    uint256 _cvpPerBlock,
    uint256 _startBlock,
    uint256 _cvpVestingPeriodInBlocks
  ) external override initializer {
    __Ownable_init();
    __ReentrancyGuard_init_unchained();

    cvp = _cvp;
    reservoir = _reservoir;
    startBlock = SafeMath32.fromUint(_startBlock, "VLPMining: too big startBlock");
    cvpVestingPeriodInBlocks = SafeMath32.fromUint(_cvpVestingPeriodInBlocks, "VLPMining: too big vest period");
    setCvpPerBlock(_cvpPerBlock);
  }

  /// @inheritdoc IVestedLPMining
  function poolLength() external view override returns (uint256) {
    return pools.length;
  }

  /// @inheritdoc IVestedLPMining
  function add(
    uint256 _allocPoint,
    IERC20 _lpToken,
    uint8 _poolType,
    bool _votesEnabled
  ) public override onlyOwner {
    require(!isLpTokenAdded(_lpToken), "VLPMining: token already added");

    massUpdatePools();
    uint32 blockNum = _currBlock();
    uint32 lastUpdateBlock = blockNum > startBlock ? blockNum : startBlock;
    totalAllocPoint = totalAllocPoint.add(_allocPoint);

    uint256 pid = pools.length;
    pools.push(
      Pool({
        lpToken: _lpToken,
        votesEnabled: _votesEnabled,
        poolType: _poolType,
        allocPoint: SafeMath32.fromUint(_allocPoint, "VLPMining: too big allocation"),
        lastUpdateBlock: lastUpdateBlock,
        accCvpPerLpt: 0
      })
    );
    poolPidByAddress[address(_lpToken)] = pid;

    emit AddLpToken(address(_lpToken), pid, _allocPoint);
  }

  /// @inheritdoc IVestedLPMining
  function set(
    uint256 _pid,
    uint256 _allocPoint,
    uint8 _poolType,
    bool _votesEnabled
  ) public override onlyOwner {
    massUpdatePools();
    totalAllocPoint = totalAllocPoint.sub(uint256(pools[_pid].allocPoint)).add(_allocPoint);
    pools[_pid].allocPoint = SafeMath32.fromUint(_allocPoint, "VLPMining: too big allocation");
    pools[_pid].votesEnabled = _votesEnabled;
    pools[_pid].poolType = _poolType;

    emit SetLpToken(address(pools[_pid].lpToken), _pid, _allocPoint);
  }

  /// @inheritdoc IVestedLPMining
  function setMigrator(ILpTokenMigrator _migrator) public override onlyOwner {
    migrator = _migrator;

    emit SetMigrator(address(_migrator));
  }

  /// @inheritdoc IVestedLPMining
  function setCvpPerBlock(uint256 _cvpPerBlock) public override onlyOwner {
    cvpPerBlock = SafeMath96.fromUint(_cvpPerBlock, "VLPMining: too big cvpPerBlock");

    emit SetCvpPerBlock(_cvpPerBlock);
  }

  /// @inheritdoc IVestedLPMining
  function setCvpVestingPeriodInBlocks(uint256 _cvpVestingPeriodInBlocks) public override onlyOwner {
    cvpVestingPeriodInBlocks = SafeMath32.fromUint(
      _cvpVestingPeriodInBlocks,
      "VLPMining: too big cvpVestingPeriodInBlocks"
    );

    emit SetCvpVestingPeriodInBlocks(_cvpVestingPeriodInBlocks);
  }

  /// @inheritdoc IVestedLPMining
  /// @dev Anyone may call, so we have to trust the migrator contract
  function migrate(uint256 _pid) public override nonReentrant {
    require(address(migrator) != address(0), "VLPMining: no migrator");
    Pool storage pool = pools[_pid];
    IERC20 lpToken = pool.lpToken;
    uint256 bal = lpToken.balanceOf(address(this));
    lpToken.safeApprove(address(migrator), bal);
    IERC20 newLpToken = migrator.migrate(lpToken, pool.poolType);
    require(bal == newLpToken.balanceOf(address(this)), "VLPMining: invalid migration");
    pool.lpToken = newLpToken;

    delete poolPidByAddress[address(lpToken)];
    poolPidByAddress[address(newLpToken)] = _pid;

    emit MigrateLpToken(address(lpToken), address(newLpToken), _pid);
  }

  /// @inheritdoc IVestedLPMining
  function getMultiplier(uint256 _from, uint256 _to) public pure override returns (uint256) {
    return _to.sub(_from, "VLPMining: _to exceeds _from");
  }

  /// @inheritdoc IVestedLPMining
  function pendingCvp(uint256 _pid, address _user) external view override returns (uint256) {
    if (_pid >= pools.length) return 0;

    Pool memory _pool = pools[_pid];
    User storage user = users[_pid][_user];

    _computePoolReward(_pool);
    uint96 newlyEntitled = _computeCvpToEntitle(user.lptAmount, user.cvpAdjust, _pool.accCvpPerLpt);

    return uint256(newlyEntitled.add(user.pendedCvp));
  }

  /// @inheritdoc IVestedLPMining
  function vestableCvp(uint256 _pid, address user) external view override returns (uint256) {
    Pool memory _pool = pools[_pid];
    User memory _user = users[_pid][user];

    _computePoolReward(_pool);
    (, uint256 newlyVested) = _computeCvpVesting(_user, _pool.accCvpPerLpt);

    return newlyVested;
  }

  /// @inheritdoc IVestedLPMining
  function isLpTokenAdded(IERC20 _lpToken) public view override returns (bool) {
    uint256 pid = poolPidByAddress[address(_lpToken)];
    return pools.length > pid && address(pools[pid].lpToken) == address(_lpToken);
  }

  /// @inheritdoc IVestedLPMining
  function massUpdatePools() public override {
    uint256 length = pools.length;
    for (uint256 pid = 0; pid < length; ++pid) {
      updatePool(pid);
    }
  }

  /// @inheritdoc IVestedLPMining
  function updatePool(uint256 _pid) public override nonReentrant {
    Pool storage pool = pools[_pid];
    _doPoolUpdate(pool);
  }

  /// @inheritdoc IVestedLPMining
  function deposit(uint256 _pid, uint256 _amount) public override nonReentrant {
    _validatePoolId(_pid);

    Pool storage pool = pools[_pid];
    User storage user = users[_pid][msg.sender];

    _doPoolUpdate(pool);
    _vestUserCvp(user, pool.accCvpPerLpt);

    if (_amount != 0) {
      pool.lpToken.safeTransferFrom(msg.sender, address(this), _amount);
      user.lptAmount = user.lptAmount.add(_amount);
    }
    user.cvpAdjust = _computeCvpAdjustment(user.lptAmount, pool.accCvpPerLpt);
    emit Deposit(msg.sender, _pid, _amount);

    _doCheckpointVotes(msg.sender);
  }

  /// @inheritdoc IVestedLPMining
  function withdraw(uint256 _pid, uint256 _amount) public override nonReentrant {
    _validatePoolId(_pid);

    Pool storage pool = pools[_pid];
    User storage user = users[_pid][msg.sender];
    require(user.lptAmount >= _amount, "VLPMining: amount exceeds balance");

    _doPoolUpdate(pool);
    _vestUserCvp(user, pool.accCvpPerLpt);

    if (_amount != 0) {
      user.lptAmount = user.lptAmount.sub(_amount);
      pool.lpToken.safeTransfer(msg.sender, _amount);
    }
    user.cvpAdjust = _computeCvpAdjustment(user.lptAmount, pool.accCvpPerLpt);
    emit Withdraw(msg.sender, _pid, _amount);

    _doCheckpointVotes(msg.sender);
  }

  /// @inheritdoc IVestedLPMining
  function emergencyWithdraw(uint256 _pid) public override nonReentrant {
    _validatePoolId(_pid);

    Pool storage pool = pools[_pid];
    User storage user = users[_pid][msg.sender];

    pool.lpToken.safeTransfer(msg.sender, user.lptAmount);
    emit EmergencyWithdraw(msg.sender, _pid, user.lptAmount);

    if (user.pendedCvp > 0) {
      // TODO: Make user.pendedCvp be updated as of the pool' lastUpdateBlock
      if (user.pendedCvp > cvpVestingPool) {
        cvpVestingPool = cvpVestingPool.sub(user.pendedCvp);
      } else {
        cvpVestingPool = 0;
      }
    }

    user.lptAmount = 0;
    user.cvpAdjust = 0;
    user.pendedCvp = 0;
    user.vestingBlock = 0;

    _doCheckpointVotes(msg.sender);
  }

  /// @inheritdoc IVestedLPMining
  function checkpointVotes(address _user) public override nonReentrant {
    _doCheckpointVotes(_user);
  }

  /// @inheritdoc IVestedLPMining
  function getCheckpoint(address account, uint32 checkpointId)
    external
    view
    override
    returns (
      uint32 fromBlock,
      uint96 cvpAmount,
      uint96 pooledCvpShare
    )
  {
    uint192 data;
    (fromBlock, data) = _getCheckpoint(account, checkpointId);
    (cvpAmount, pooledCvpShare) = _unpackData(data);
  }

  function _doCheckpointVotes(address _user) internal {
    uint256 length = pools.length;
    uint96 userPendedCvp = 0;
    uint256 userTotalLpCvp = 0;
    uint96 totalLpCvp = 0;
    for (uint256 pid = 0; pid < length; ++pid) {
      userPendedCvp = userPendedCvp.add(users[pid][_user].pendedCvp);

      Pool storage pool = pools[pid];
      uint96 lpCvp =
        SafeMath96.fromUint(
          cvp.balanceOf(address(pool.lpToken)),
          // this and similar error messages are not intended for end-users
          "VLPMining::_doCheckpointVotes:1"
        );
      totalLpCvp = totalLpCvp.add(lpCvp);

      if (!pool.votesEnabled) {
        continue;
      }

      uint256 lptTotalSupply = pool.lpToken.totalSupply();
      uint256 lptAmount = users[pid][_user].lptAmount;
      if (lptAmount != 0 && lptTotalSupply != 0) {
        uint256 cvpPerLpt = uint256(lpCvp).mul(SCALE).div(lptTotalSupply);
        uint256 userLpCvp = lptAmount.mul(cvpPerLpt).div(SCALE);
        userTotalLpCvp = userTotalLpCvp.add(userLpCvp);

        emit CheckpointUserLpVotes(_user, pid, userLpCvp);
      }
    }

    uint96 lpCvpUserShare =
      (userTotalLpCvp == 0 || totalLpCvp == 0)
        ? 0
        : SafeMath96.fromUint(userTotalLpCvp.mul(SCALE).div(totalLpCvp), "VLPMining::_doCheckpointVotes:2");

    emit CheckpointTotalLpVotes(totalLpCvp);
    emit CheckpointUserVotes(_user, uint256(userPendedCvp), lpCvpUserShare);

    _writeUserData(_user, _packData(userPendedCvp, lpCvpUserShare));
    _writeSharedData(_packData(totalLpCvp, 0));
  }

  function _transferCvp(address _to, uint256 _amount) internal {
    SafeERC20.safeTransferFrom(cvp, reservoir, _to, _amount);
  }

  /// @dev must be guarded for reentrancy
  function _doPoolUpdate(Pool storage pool) internal {
    Pool memory _pool = pool;
    uint32 prevBlock = _pool.lastUpdateBlock;
    uint256 prevAcc = _pool.accCvpPerLpt;

    uint256 cvpReward = _computePoolReward(_pool);
    if (cvpReward != 0) {
      cvpVestingPool = cvpVestingPool.add(
        SafeMath96.fromUint(cvpReward, "VLPMining::_doPoolUpdate:1"),
        "VLPMining::_doPoolUpdate:2"
      );
    }
    if (_pool.accCvpPerLpt > prevAcc) {
      pool.accCvpPerLpt = _pool.accCvpPerLpt;
    }
    if (_pool.lastUpdateBlock > prevBlock) {
      pool.lastUpdateBlock = _pool.lastUpdateBlock;
    }
  }

  function _vestUserCvp(User storage user, uint256 accCvpPerLpt) internal {
    User memory _user = user;
    uint32 prevVestingBlock = _user.vestingBlock;
    uint32 prevUpdateBlock = _user.lastUpdateBlock;
    (uint256 newlyEntitled, uint256 newlyVested) = _computeCvpVesting(_user, accCvpPerLpt);

    if (newlyEntitled != 0) {
      user.pendedCvp = _user.pendedCvp;
    }
    if (newlyVested != 0) {
      if (newlyVested > cvpVestingPool) newlyVested = uint256(cvpVestingPool);
      cvpVestingPool = cvpVestingPool.sub(
        SafeMath96.fromUint(newlyVested, "VLPMining::_vestUserCvp:1"),
        "VLPMining::_vestUserCvp:2"
      );
      _transferCvp(msg.sender, newlyVested);
    }
    if (_user.vestingBlock > prevVestingBlock) {
      user.vestingBlock = _user.vestingBlock;
    }
    if (_user.lastUpdateBlock > prevUpdateBlock) {
      user.lastUpdateBlock = _user.lastUpdateBlock;
    }
  }

  /* @dev Compute the amount of CVP tokens to be entitled and vested to a user of a pool
   * ... and update the `_user` instance (in the memory):
   *   `_user.pendedCvp` gets increased by `newlyEntitled - newlyVested`
   *   `_user.vestingBlock` set to the updated value
   *   `_user.lastUpdateBlock` set to the current block
   *
   * @param _user - user to compute tokens for
   * @param accCvpPerLpt - value of the pool' `pool.accCvpPerLpt`
   * @return newlyEntitled - CVP amount to entitle (on top of tokens entitled so far)
   * @return newlyVested - CVP amount to vest (on top of tokens already vested)
   */
  function _computeCvpVesting(User memory _user, uint256 accCvpPerLpt)
    internal
    view
    returns (uint256 newlyEntitled, uint256 newlyVested)
  {
    uint32 prevBlock = _user.lastUpdateBlock;
    _user.lastUpdateBlock = _currBlock();
    if (prevBlock >= _user.lastUpdateBlock) {
      return (0, 0);
    }

    uint32 age = _user.lastUpdateBlock - prevBlock;

    // Tokens which are to be entitled starting from the `user.lastUpdateBlock`, shall be
    // vested proportionally to the number of blocks already minted within the period between
    // the `user.lastUpdateBlock` and `cvpVestingPeriodInBlocks` following the current block
    newlyEntitled = uint256(_computeCvpToEntitle(_user.lptAmount, _user.cvpAdjust, accCvpPerLpt));
    uint256 newToVest =
      newlyEntitled == 0 ? 0 : (newlyEntitled.mul(uint256(age)).div(uint256(age + cvpVestingPeriodInBlocks)));

    // Tokens which have been pended since the `user.lastUpdateBlock` shall be vested:
    // - in full, if the `user.vestingBlock` has been mined
    // - otherwise, proportionally to the number of blocks already mined so far in the period
    //   between the `user.lastUpdateBlock` and the `user.vestingBlock` (not yet mined)
    uint256 pended = uint256(_user.pendedCvp);
    age = _user.lastUpdateBlock >= _user.vestingBlock ? cvpVestingPeriodInBlocks : _user.lastUpdateBlock - prevBlock;
    uint256 pendedToVest =
      pended == 0
        ? 0
        : (
          age >= cvpVestingPeriodInBlocks
            ? pended
            : pended.mul(uint256(age)).div(uint256(_user.vestingBlock - prevBlock))
        );

    newlyVested = pendedToVest.add(newToVest);
    _user.pendedCvp = SafeMath96.fromUint(
      uint256(_user.pendedCvp).add(newlyEntitled).sub(newlyVested),
      "VLPMining::computeCvpVest:1"
    );

    // Amount of CVP token pended (i.e. not yet vested) from now
    uint256 remainingPended = pended == 0 ? 0 : pended.sub(pendedToVest);
    uint256 unreleasedNewly = newlyEntitled == 0 ? 0 : newlyEntitled.sub(newToVest);
    uint256 pending = remainingPended.add(unreleasedNewly);

    // Compute the vesting block (i.e. when the pended tokens to be all vested)
    uint256 period = 0;
    if (remainingPended == 0 || pending == 0) {
      // newly entitled CVPs only or nothing remain pended
      period = cvpVestingPeriodInBlocks;
    } else {
      // "old" CVPs and, perhaps, "new" CVPs are pending - the weighted average applied
      age = _user.vestingBlock - _user.lastUpdateBlock;
      period = ((remainingPended.mul(age)).add(unreleasedNewly.mul(cvpVestingPeriodInBlocks))).div(pending);
    }
    _user.vestingBlock =
      _user.lastUpdateBlock +
      (cvpVestingPeriodInBlocks > uint32(period) ? uint32(period) : cvpVestingPeriodInBlocks);

    return (newlyEntitled, newlyVested);
  }

  function _computePoolReward(Pool memory _pool) internal view returns (uint256 poolCvpReward) {
    poolCvpReward = 0;
    uint32 blockNum = _currBlock();
    if (blockNum > _pool.lastUpdateBlock) {
      uint256 multiplier = uint256(blockNum - _pool.lastUpdateBlock); // can't overflow
      _pool.lastUpdateBlock = blockNum;

      uint256 lptBalance = _pool.lpToken.balanceOf(address(this));
      if (lptBalance != 0) {
        poolCvpReward = multiplier.mul(uint256(cvpPerBlock)).mul(uint256(_pool.allocPoint)).div(totalAllocPoint);

        _pool.accCvpPerLpt = _pool.accCvpPerLpt.add(poolCvpReward.mul(SCALE).div(lptBalance));
      }
    }
  }

  function _computeUserVotes(uint192 userData, uint192 sharedData) internal pure override returns (uint96 votes) {
    (uint96 ownCvp, uint96 pooledCvpShare) = _unpackData(userData);
    (uint96 totalPooledCvp, ) = _unpackData(sharedData);

    if (pooledCvpShare == 0) {
      votes = ownCvp;
    } else {
      uint256 pooledCvp = uint256(pooledCvpShare).mul(totalPooledCvp).div(SCALE);
      votes = ownCvp.add(SafeMath96.fromUint(pooledCvp, "VLPMining::_computeVotes"));
    }
  }

  function _computeCvpToEntitle(
    uint256 userLpt,
    uint96 userCvpAdjust,
    uint256 poolAccCvpPerLpt
  ) private pure returns (uint96) {
    return
      userLpt == 0
        ? 0
        : (
          SafeMath96.fromUint(userLpt.mul(poolAccCvpPerLpt).div(SCALE), "VLPMining::computeCvp:1").sub(
            userCvpAdjust,
            "VLPMining::computeCvp:2"
          )
        );
  }

  function _computeCvpAdjustment(uint256 lptAmount, uint256 accCvpPerLpt) private pure returns (uint96) {
    return SafeMath96.fromUint(lptAmount.mul(accCvpPerLpt).div(SCALE), "VLPMining::_computeCvpAdj");
  }

  function _validatePoolId(uint256 pid) private view {
    require(pid < pools.length, "VLPMining: invalid pool id");
  }

  function _currBlock() private view returns (uint32) {
    return SafeMath32.fromUint(block.number, "VLPMining::_currBlock:overflow");
  }
}
