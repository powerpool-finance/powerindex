pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IMigrator.sol";
import "./Checkpoints.sol";


// LPMining is the master of Cvp. He can make Cvp and he is a fair guy.
//
// Note that it's ownable and the owner wields tremendous power. The ownership
// will be transferred to a governance smart contract once CVP is sufficiently
// distributed and the community can show to govern itself.
//
// Have fun reading it. Hopefully it's bug-free. God bless.
contract LPMining is Ownable, Checkpoints {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each user.
    struct UserInfo {
        uint256 amount;     // How many LP tokens the user has provided.
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
        IERC20 lpToken;           // Address of LP token contract.
        uint256 allocPoint;       // How many allocation points assigned to this pool. CVPs to distribute per block.
        uint256 lastRewardBlock;  // Last block number that CVPs distribution occurs.
        uint256 accCvpPerShare; // Accumulated CVPs per share, times 1e12. See below.
    }

    // The CVP TOKEN!
    IERC20 public cvp;
    // Dev address.
    address public devaddr;
    // Reservoir address.
    address public reservoir;
    // CVP tokens created per block.
    uint256 public cvpPerBlock;
    // The migrator contract. It has a lot of power. Can only be set through governance (owner).
    IMigrator public migrator;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens.
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;
    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;
    // The block number when CVP mining starts.
    uint256 public startBlock;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event CheckpointVotes(address indexed user, uint256 votes, uint256 price);

    constructor(
        IERC20 _cvp,
        address _reservoir,
        address _devaddr,
        uint256 _cvpPerBlock,
        uint256 _startBlock
    ) public {
        cvp = _cvp;
        reservoir = _reservoir;
        devaddr = _devaddr;
        cvpPerBlock = _cvpPerBlock;
        startBlock = _startBlock;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(uint256 _allocPoint, IERC20 _lpToken, bool _withUpdate) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardBlock: lastRewardBlock,
            accCvpPerShare: 0
        }));
    }

    // Update the given pool's CVP allocation point. Can only be called by the owner.
    function set(uint256 _pid, uint256 _allocPoint, bool _withUpdate) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    // Set the migrator contract. Can only be called by the owner.
    function setMigrator(IMigrator _migrator) public onlyOwner {
        migrator = _migrator;
    }

    // Migrate lp token to another lp contract. Can be called by anyone. We trust that migrator contract is good.
    function migrate(uint256 _pid) public {
        require(address(migrator) != address(0), "migrate: no migrator");
        PoolInfo storage pool = poolInfo[_pid];
        IERC20 lpToken = pool.lpToken;
        uint256 bal = lpToken.balanceOf(address(this));
        lpToken.safeApprove(address(migrator), bal);
        IERC20 newLpToken = migrator.migrate(lpToken);
        require(bal == newLpToken.balanceOf(address(this)), "migrate: bad");
        pool.lpToken = newLpToken;
    }

    // Return reward multiplier over the given _from to _to block.
    function getMultiplier(uint256 _from, uint256 _to) public view returns (uint256) {
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
        cvp.transferFrom(reservoir, devaddr, cvpReward.div(10));
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
            if(pending > 0) {
                safeCvpTransfer(msg.sender, pending);
            }
        }
        if(_amount > 0) {
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            user.amount = user.amount.add(_amount);
        }
        user.rewardDebt = user.amount.mul(pool.accCvpPerShare).div(1e12);
        emit Deposit(msg.sender, _pid, _amount);

        checkpointVotes(_pid, msg.sender);
    }

    // Withdraw LP tokens from LPMining.
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "withdraw: not good");
        updatePool(_pid);
        uint256 pending = user.amount.mul(pool.accCvpPerShare).div(1e12).sub(user.rewardDebt);
        if(pending > 0) {
            safeCvpTransfer(msg.sender, pending);
        }
        if(_amount > 0) {
            user.amount = user.amount.sub(_amount);
            pool.lpToken.safeTransfer(address(msg.sender), _amount);
        }
        user.rewardDebt = user.amount.mul(pool.accCvpPerShare).div(1e12);
        emit Withdraw(msg.sender, _pid, _amount);

        checkpointVotes(_pid, msg.sender);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        pool.lpToken.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
        user.amount = 0;
        user.rewardDebt = 0;

        checkpointVotes(_pid, msg.sender);
    }

    function checkpointVotes(uint256 _pid, address _user) public {
        PoolInfo storage pool = poolInfo[_pid];

        uint256 userLpTokenBalance = userInfo[_pid][_user].amount;
        uint256 lpTokenTotalSupply = pool.lpToken.totalSupply();

        uint256 lpCvpBalance = cvp.balanceOf(address(pool.lpToken));
        uint256 cvpPrice = lpCvpBalance.mul(1e12).div(lpTokenTotalSupply);
        uint256 votesBalance = userLpTokenBalance.mul(cvpPrice).div(1e12);

        _writeBalance(_user, safe96(votesBalance, "LPMining::checkpointVotes: Amount overflow"));

        emit CheckpointVotes(_user, votesBalance, cvpPrice);
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

    // Update dev address by the previous dev.
    function dev(address _devaddr) public {
        require(msg.sender == devaddr, "dev: wut?");
        devaddr = _devaddr;
    }
}
