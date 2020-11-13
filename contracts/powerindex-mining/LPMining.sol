// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IMigrator.sol";
import "./Checkpoints.sol";

// Note that LPMining is ownable and the owner wields tremendous power. The ownership
// will be transferred to a governance smart contract
// and the community can show to govern itself.
contract LPMining is Ownable, Checkpoints {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  // Info of each user.
  struct UserInfo {
    uint256 amount; // How many LP tokens the user has provided.
    uint256 rewardDebt; // Reward debt. See explanation below.
    //
    // We do some fancy math here. Basically, any point in time, the amount of CVPs
    // entitled to a user but is pending to be distributed is:
    //
    //   pending reward = (user.amount * pool.accCvpPerShare) - user.rewardDebt
    //
    // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
    //   1. The pool's `accCvpPerShare` (and `lastRewardBlock`) gets updated.
    //   2. User receives the pending reward sent to his/her address.
    //   3. User's `amount` gets updated.
    //   4. User's `rewardDebt` gets updated.
  }

  // Info of each pool.
  struct PoolInfo {
    IERC20 lpToken; // Address of LP token contract.
    uint256 allocPoint; // How many allocation points assigned to this pool. CVPs to distribute per block.
    uint256 lastRewardBlock; // Last block number that CVPs distribution occurs.
    uint256 accCvpPerShare; // Accumulated CVPs per share, times 1e12. See below.
    bool votesEnabled; // Pool enabled to write votes
    uint8 poolType; // Pool type (1 For Uniswap, 2 for Balancer)
  }

  // The CVP TOKEN!
  IERC20 public cvp;
  // Reservoir address.
  address public reservoir;
  // CVP tokens reward per block.
  uint256 public cvpPerBlock;
  // The migrator contract. It has a lot of power. Can only be set through governance (owner).
  IMigrator public migrator;

  // Info of each pool.
  PoolInfo[] public poolInfo;
  // Pid of each pool by its address
  mapping(address => uint256) public poolPidByAddress;
  // Info of each user that stakes LP tokens.
  mapping(uint256 => mapping(address => UserInfo)) public userInfo;
  // Total allocation poitns. Must be the sum of all allocation points in all pools.
  uint256 public totalAllocPoint = 0;
  // The block number when CVP powerindex-mining starts.
  uint256 public startBlock;

  event AddLpToken(address indexed lpToken, uint256 indexed pid, uint256 allocPoint);
  event SetLpToken(address indexed lpToken, uint256 indexed pid, uint256 allocPoint);
  event SetMigrator(address indexed migrator);
  event SetCvpPerBlock(uint256 cvpPerBlock);
  event MigrateLpToken(address indexed oldLpToken, address indexed newLpToken, uint256 indexed pid);

  event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
  event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
  event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
  event CheckpointPoolVotes(address indexed user, uint256 indexed pid, uint256 votes, uint256 price);
  event CheckpointTotalVotes(address indexed user, uint256 votes);

  constructor(
    IERC20 _cvp,
    address _reservoir,
    uint256 _cvpPerBlock,
    uint256 _startBlock
  ) public {
    cvp = _cvp;
    reservoir = _reservoir;
    cvpPerBlock = _cvpPerBlock;
    startBlock = _startBlock;

    emit SetCvpPerBlock(_cvpPerBlock);
  }

  function poolLength() external view returns (uint256) {
    return poolInfo.length;
  }

  // Add a new lp to the pool. Can only be called by the owner.
  function add(
    uint256 _allocPoint,
    IERC20 _lpToken,
    uint8 _poolType,
    bool _votesEnabled
  ) public onlyOwner {
    require(!isLpTokenAdded(_lpToken), "add: Lp token already added");

    massUpdatePools();
    uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
    totalAllocPoint = totalAllocPoint.add(_allocPoint);

    uint256 pid = poolInfo.length;
    poolInfo.push(
      PoolInfo({
        lpToken: _lpToken,
        allocPoint: _allocPoint,
        lastRewardBlock: lastRewardBlock,
        accCvpPerShare: 0,
        votesEnabled: _votesEnabled,
        poolType: _poolType
      })
    );
    poolPidByAddress[address(_lpToken)] = pid;

    emit AddLpToken(address(_lpToken), pid, _allocPoint);
  }

  // Update the given pool's CVP allocation point. Can only be called by the owner.
  function set(
    uint256 _pid,
    uint256 _allocPoint,
    uint8 _poolType,
    bool _votesEnabled
  ) public onlyOwner {
    massUpdatePools();
    totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
    poolInfo[_pid].allocPoint = _allocPoint;
    poolInfo[_pid].votesEnabled = _votesEnabled;
    poolInfo[_pid].poolType = _poolType;

    emit SetLpToken(address(poolInfo[_pid].lpToken), _pid, _allocPoint);
  }

  // Set the migrator contract. Can only be called by the owner.
  function setMigrator(IMigrator _migrator) public onlyOwner {
    migrator = _migrator;

    emit SetMigrator(address(_migrator));
  }

  // Set CVP reward per block. Can only be called by the owner.
  function setCvpPerBlock(uint256 _cvpPerBlock) public onlyOwner {
    cvpPerBlock = _cvpPerBlock;

    emit SetCvpPerBlock(_cvpPerBlock);
  }

  // Migrate lp token to another lp contract. Can be called by anyone. We trust that migrator contract is good.
  function migrate(uint256 _pid) public {
    require(address(migrator) != address(0), "migrate: no migrator");
    PoolInfo storage pool = poolInfo[_pid];
    IERC20 lpToken = pool.lpToken;
    uint256 bal = lpToken.balanceOf(address(this));
    lpToken.safeApprove(address(migrator), bal);
    IERC20 newLpToken = migrator.migrate(lpToken, pool.poolType);
    require(bal == newLpToken.balanceOf(address(this)), "migrate: bad");
    pool.lpToken = newLpToken;

    delete poolPidByAddress[address(lpToken)];
    poolPidByAddress[address(newLpToken)] = _pid;

    emit MigrateLpToken(address(lpToken), address(newLpToken), _pid);
  }

  // Return reward multiplier over the given _from to _to block.
  function getMultiplier(uint256 _from, uint256 _to) public pure returns (uint256) {
    return _to.sub(_from);
  }

  // View function to see pending CVPs on frontend.
  function pendingCvp(uint256 _pid, address _user) external view returns (uint256) {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][_user];
    uint256 accCvpPerShare = pool.accCvpPerShare;
    uint256 lpSupply = pool.lpToken.balanceOf(address(this));
    if (block.number > pool.lastRewardBlock && lpSupply != 0) {
      uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
      uint256 cvpReward = multiplier.mul(cvpPerBlock).mul(pool.allocPoint).div(totalAllocPoint);
      accCvpPerShare = accCvpPerShare.add(cvpReward.mul(1e12).div(lpSupply));
    }
    return user.amount.mul(accCvpPerShare).div(1e12).sub(user.rewardDebt);
  }

  // Return bool - is Lp Token added or not
  function isLpTokenAdded(IERC20 _lpToken) public view returns (bool) {
    uint256 pid = poolPidByAddress[address(_lpToken)];
    return poolInfo.length > pid && address(poolInfo[pid].lpToken) == address(_lpToken);
  }

  // Update reward variables for all pools. Be careful of gas spending!
  function massUpdatePools() public {
    uint256 length = poolInfo.length;
    for (uint256 pid = 0; pid < length; ++pid) {
      updatePool(pid);
    }
  }

  // Update reward variables of the given pool to be up-to-date.
  function updatePool(uint256 _pid) public {
    PoolInfo storage pool = poolInfo[_pid];
    if (block.number <= pool.lastRewardBlock) {
      return;
    }
    uint256 lpSupply = pool.lpToken.balanceOf(address(this));
    if (lpSupply == 0) {
      pool.lastRewardBlock = block.number;
      return;
    }
    uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
    uint256 cvpReward = multiplier.mul(cvpPerBlock).mul(pool.allocPoint).div(totalAllocPoint);
    cvp.transferFrom(reservoir, address(this), cvpReward);
    pool.accCvpPerShare = pool.accCvpPerShare.add(cvpReward.mul(1e12).div(lpSupply));
    pool.lastRewardBlock = block.number;
  }

  // Deposit LP tokens to LPMining for CVP allocation.
  function deposit(uint256 _pid, uint256 _amount) public {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    updatePool(_pid);
    if (user.amount > 0) {
      uint256 pending = user.amount.mul(pool.accCvpPerShare).div(1e12).sub(user.rewardDebt);
      if (pending > 0) {
        safeCvpTransfer(msg.sender, pending);
      }
    }
    if (_amount > 0) {
      pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
      user.amount = user.amount.add(_amount);
    }
    user.rewardDebt = user.amount.mul(pool.accCvpPerShare).div(1e12);
    emit Deposit(msg.sender, _pid, _amount);

    checkpointVotes(msg.sender);
  }

  // Withdraw LP tokens from LPMining.
  function withdraw(uint256 _pid, uint256 _amount) public {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    require(user.amount >= _amount, "withdraw: not good");
    updatePool(_pid);
    uint256 pending = user.amount.mul(pool.accCvpPerShare).div(1e12).sub(user.rewardDebt);
    if (pending > 0) {
      safeCvpTransfer(msg.sender, pending);
    }
    if (_amount > 0) {
      user.amount = user.amount.sub(_amount);
      pool.lpToken.safeTransfer(address(msg.sender), _amount);
    }
    user.rewardDebt = user.amount.mul(pool.accCvpPerShare).div(1e12);
    emit Withdraw(msg.sender, _pid, _amount);

    checkpointVotes(msg.sender);
  }

  // Withdraw without caring about rewards. EMERGENCY ONLY.
  function emergencyWithdraw(uint256 _pid) public {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    pool.lpToken.safeTransfer(address(msg.sender), user.amount);
    emit EmergencyWithdraw(msg.sender, _pid, user.amount);
    user.amount = 0;
    user.rewardDebt = 0;

    checkpointVotes(msg.sender);
  }

  // Write votes at current block
  function checkpointVotes(address _user) public {
    uint256 length = poolInfo.length;

    uint256 totalVotesBalance = 0;
    for (uint256 pid = 0; pid < length; ++pid) {
      PoolInfo storage pool = poolInfo[pid];

      uint256 userLpTokenBalance = userInfo[pid][_user].amount;
      if (userLpTokenBalance == 0 || !pool.votesEnabled) {
        continue;
      }
      uint256 lpTokenTotalSupply = pool.lpToken.totalSupply();
      if (lpTokenTotalSupply == 0) {
        continue;
      }

      uint256 lpCvpBalance = cvp.balanceOf(address(pool.lpToken));
      uint256 lpCvpPrice = lpCvpBalance.mul(1e12).div(lpTokenTotalSupply);
      uint256 lpVotesBalance = userLpTokenBalance.mul(lpCvpPrice).div(1e12);

      totalVotesBalance = totalVotesBalance.add(lpVotesBalance);
      emit CheckpointPoolVotes(_user, pid, lpVotesBalance, lpCvpPrice);
    }

    emit CheckpointTotalVotes(_user, totalVotesBalance);

    _writeBalance(_user, safe96(totalVotesBalance, "LPMining::checkpointVotes: Amount overflow"));
  }

  // Safe cvp transfer function, just in case if rounding error causes pool to not have enough CVPs.
  function safeCvpTransfer(address _to, uint256 _amount) internal {
    uint256 cvpBal = cvp.balanceOf(address(this));
    if (_amount > cvpBal) {
      cvp.transfer(_to, cvpBal);
    } else {
      cvp.transfer(_to, _amount);
    }
  }
}
