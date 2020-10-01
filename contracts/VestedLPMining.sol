pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IMigrator.sol";
import "./Checkpoints.sol";


/**
 * @notice
 */
contract VestedLPMining is Ownable, ReentrancyGuard, Checkpoints {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct User {
        uint256 lptAmount;        // amount of LP tokens the user has provided to a pool
        uint256 cvpAdjust;        // adjustments for computation pending CVP tokens amount
                                  // (with regard to LP token deposits/withdrawals in the past)
        uint256 entitledCvp;      // (accumulated) amount of CVPs tokens entitled to the user so far
        uint256 vestedCvp;        // (accumulated) amount of CVPs tokens vested to the user so far
        uint32 vestingBlock;      // block by when all entitled CVP tokens to be vested
        uint32 lastUpdateBlock;   // block when the params (above) were updated
        /** @dev
         * At any time, the amount of CVP tokens entitled to a user but not yet vested (released) is:
         *   pendingCVP = ( user.lptAmount * pool.accCvpPerLpt - user.cvpAdjust );
         * By that time, the amount of CVP tokens that may be vested (released) to the user is:
         *   vestableCVP =  user.entitledCvp + pendingCVP - user.vestedCvp
         *
         * Whenever a user deposits or withdraws LP tokens to a pool:
         *   1. The pool's `accCvpPerLpt` gets updated;
         *   2. User's `lptAmount` and `cvpAdjust` and `entitledCvp` get updated;
         *   3. CVP tokens amount that may be vested to the user (`vestableCVP`) gets computed;
         *   4. The user receives `vestableCVP` tokens (sent to his/her account);
         *   5. User's `vestedCvp` gets updated.
         */
    }

    struct Pool {
        IERC20 lpToken;           // address of the LP token contract
        bool votesEnabled;        // if the pool is enabled to write votes
        uint8 poolType;           // pool type (1 - Uniswap, 2 - Balancer)
        uint32 allocPoint;        // points assigned to the pool, which affect CVPs distribution between pools
        uint32 lastUpdateBlock;   // latest block when the pool params which follow was updated
        uint256 accCvpPerLpt;     // accumulated distributed CVPs per one deposited LP token, times 1e12
        uint256 cvpBalance;       // total amount of CVP tokens pending to be vested to the pool' users
    }
    // scale factor for `accCvpPerLpt`
    uint256 internal constant SCALE = 1e12;

    // The CVP TOKEN
    IERC20 public cvp;
    // Reservoir address
    address public reservoir;
    // Vesting duration in blocks
    uint32 cvpVestingPeriodInBlocks;
    // The amount of CVP tokens rewarded to all pools every block
    uint256 public cvpPerBlock;
    // The migrator contract (only the owner may assign it)
    IMigrator public migrator;

    // Params of each pool
    Pool[] public pools;
    // Pid (i.e. the index in `pools`) of each pool by its LP token address
    mapping(address => uint256) public poolPidByAddress;
    // Params of each user that stakes LP tokens, by the Pid and the user address
    mapping (uint256 => mapping (address => User)) public users;
    // Sum of allocation points for all pools
    uint256 public totalAllocPoint = 0;
    // The block number when CVP mining starts
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
        uint256 _startBlock,
        uint256 _cvpVestingBlocks
    ) public {
        cvp = _cvp;
        reservoir = _reservoir;
        cvpPerBlock = _cvpPerBlock;
        startBlock = _startBlock;
        cvpVestingPeriodInBlocks = safeUint32(_cvpVestingBlocks);

        emit SetCvpPerBlock(_cvpPerBlock);
    }

    function poolLength() external view returns (uint256) {
        return pools.length;
    }

    /// @notice Add a new pool (only the owner may call)
    function add(uint256 _allocPoint, IERC20 _lpToken, uint8 _poolType, bool _votesEnabled, bool _withUpdate)
    public onlyOwner
    {
        require(!isLpTokenAdded(_lpToken), "VestedLPMining: LP token already added");

        if (_withUpdate) {
            updateAllPools();
        }
        uint256 lastUpdateBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);

        uint256 pid = pools.length;
        pools.push(Pool({
            lpToken: _lpToken,
            votesEnabled: _votesEnabled,
            poolType: _poolType,
            allocPoint: safeUint32(_allocPoint),
            lastUpdateBlock: uint32(lastUpdateBlock),
            accCvpPerLpt: 0,
            cvpBalance: 0
        }));
        poolPidByAddress[address(_lpToken)] = pid;

        emit AddLpToken(address(_lpToken), pid, _allocPoint);
    }

    /// @notice Update parameters of the given pool (only the owner may call)
    function set(uint256 _pid, uint256 _allocPoint, uint8 _poolType, bool _votesEnabled, bool _withUpdate)
    public onlyOwner
    {
        if (_withUpdate) {
            updateAllPools();
        }
        totalAllocPoint = totalAllocPoint.sub(uint256(pools[_pid].allocPoint)).add(_allocPoint);
        pools[_pid].allocPoint = safeUint32(_allocPoint);
        pools[_pid].votesEnabled = _votesEnabled;
        pools[_pid].poolType = _poolType;

        emit SetLpToken(address(pools[_pid].lpToken), _pid, _allocPoint);
    }

    /// @notice Set the migrator contract (only the owner may call)
    function setMigrator(IMigrator _migrator) public onlyOwner {
        migrator = _migrator;

        emit SetMigrator(address(_migrator));
    }

    /// @notice Set CVP reward per block (only the owner may call)
    /// @dev Consider updating pool before calling this function
    function setCvpPerBlock(uint256 _cvpPerBlock) public onlyOwner {
        cvpPerBlock = _cvpPerBlock;

        emit SetCvpPerBlock(_cvpPerBlock);
    }

    /// @notice Migrate LP token to another LP contract
    /// @dev Anyone may call, so we have to trust the migrator contract
    function migrate(uint256 _pid) public nonReentrant {
        require(address(migrator) != address(0), "VestedLPMining: no migrator");
        Pool storage pool = pools[_pid];
        IERC20 lpToken = pool.lpToken;
        uint256 bal = lpToken.balanceOf(address(this));
        lpToken.safeApprove(address(migrator), bal);
        IERC20 newLpToken = migrator.migrate(lpToken, pool.poolType);
        require(bal == newLpToken.balanceOf(address(this)), "VestedLPMining: invalid migration");
        pool.lpToken = newLpToken;

        delete poolPidByAddress[address(lpToken)];
        poolPidByAddress[address(newLpToken)] = _pid;

        emit MigrateLpToken(address(lpToken), address(newLpToken), _pid);
    }

    /// @notice Return reward multiplier over the given _from to _to block
    function getMultiplier(uint256 _from, uint256 _to) public view returns (uint256) {
        return _to.sub(_from);
    }

    /// @notice Return the amount of pending CVPs entitled to the given user of the pool
    /// @dev Intended for frontend use
    function pendingCvp(uint256 _pid, address _user) external view returns (uint256) {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][_user];
        (uint256 newAccCvpPerLpt, , ) = computePoolReward(pool);
        return computeCvpToEntitle(
            user.lptAmount,
            user.cvpAdjust,
            newAccCvpPerLpt > 0 ? newAccCvpPerLpt : pool.accCvpPerLpt
        );
    }

    /// @notice Return the amount of CVP tokens which may be vested to a user of a pool in the current block
    /// @dev Intended for frontend use
    function vestableCvp(uint256 _pid, address _user) external view returns (uint256) {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][_user];
        (uint256 newAccCvpPerLpt, , ) = computePoolReward(pool);

        ( , uint256 newlyVested, , , ) = computeCvpVesting(
            user,
            newAccCvpPerLpt > 0 ? newAccCvpPerLpt : pool.accCvpPerLpt
        );

        return newlyVested;
    }

    /// @notice Return `true` if the LP Token is added to created pools
    function isLpTokenAdded(IERC20 _lpToken) public view returns (bool) {
        uint256 pid = poolPidByAddress[address(_lpToken)];
        return pools.length > pid && address(pools[pid].lpToken) == address(_lpToken);
    }

    /// @notice Update reward computation params for all pools
    /// @dev Be careful of gas spending
    function updateAllPools() public {
        uint256 length = pools.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    /// @notice Update CVP tokens allocation for the given pool
    function updatePool(uint256 _pid) public nonReentrant {
        Pool storage pool = pools[_pid];
        doPoolUpdate(pool);
    }

    /// @notice Deposit the given amount of LP tokens to the given pool
    function deposit(uint256 _pid, uint256 _amount) public nonReentrant {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][msg.sender];

        uint256 vested = vestUserCvp(user, pool.accCvpPerLpt);

        if (vested > 0) {
            pool.cvpBalance.sub(vested);
        }
        if(_amount > 0) {
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            user.lptAmount = user.lptAmount.add(_amount);
        }
        user.cvpAdjust = user.lptAmount.mul(pool.accCvpPerLpt).div(SCALE);
        emit Deposit(msg.sender, _pid, _amount);

        checkpointVotes(msg.sender);
    }

    /// @notice Withdraw the given amount of LP tokens from the given pool
    function withdraw(uint256 _pid, uint256 _amount) public nonReentrant {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][msg.sender];
        require(user.lptAmount >= _amount, "VestedLPMining: amount exceeds balance");

        doPoolUpdate(pool);
        uint256 vested = vestUserCvp(user, pool.accCvpPerLpt);

        if (vested > 0) {
            pool.cvpBalance.sub(vested);
        }
        if(_amount > 0) {
            user.lptAmount = user.lptAmount.sub(_amount);
            pool.lpToken.safeTransfer(address(msg.sender), _amount);
        }
        user.cvpAdjust = user.lptAmount.mul(pool.accCvpPerLpt).div(SCALE);
        emit Withdraw(msg.sender, _pid, _amount);

        checkpointVotes(msg.sender);
    }

    /// @notice Withdraw LP tokens without caring about pending CVP tokens. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public nonReentrant {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][msg.sender];

        pool.lpToken.safeTransfer(address(msg.sender), user.lptAmount);
        emit EmergencyWithdraw(msg.sender, _pid, user.lptAmount);

        if (user.entitledCvp > user.vestedCvp) {
            pool.cvpBalance.sub(user.entitledCvp.sub(user.vestedCvp));
        }

        user.lptAmount = 0;
        user.cvpAdjust = 0;
        user.entitledCvp = 0;
        user.vestedCvp = 0;
        user.vestingBlock = 0;

        checkpointVotes(msg.sender);
    }

    /// @notice Write votes of the given user at the current block
    function checkpointVotes(address _user) public nonReentrant {
        uint256 length = pools.length;

        uint256 totalVotes = 0;
        for (uint256 pid = 0; pid < length; ++pid) {
            Pool storage pool = pools[pid];

            uint256 lptAmount = users[pid][_user].lptAmount;
            if (lptAmount == 0 || !pool.votesEnabled) {
                continue;
            }
            uint256 lptTotalSupply = pool.lpToken.totalSupply();
            if (lptTotalSupply == 0) {
                continue;
            }

            uint256 poolCvpBalance = cvp.balanceOf(address(pool.lpToken));
            uint256 lptCvpPrice = poolCvpBalance.mul(SCALE).div(lptTotalSupply);
            uint256 votes = lptAmount.mul(lptCvpPrice).div(SCALE);

            totalVotes = totalVotes.add(votes);
            emit CheckpointPoolVotes(_user, pid, votes, lptCvpPrice);
        }

        emit CheckpointTotalVotes(_user, totalVotes);

        _writeBalance(_user, safe96(totalVotes, "VestedLPMining: Amount overflow"));
    }

    function transferCvp(address _to, uint256 _amount) internal {
        SafeERC20.safeTransferFrom(cvp, reservoir, _to, _amount);
    }

    /// @dev must be guarded for reentrancy
    function doPoolUpdate(Pool storage pool) internal {
        (uint256 newAccCvpPerLpt, uint256 poolCvpReward, uint32 newLastUpdateBlock) = computePoolReward(pool);

        if (newAccCvpPerLpt > 0) {
            pool.accCvpPerLpt = newAccCvpPerLpt;
        }
        if (poolCvpReward > 0) {
            pool.cvpBalance = pool.cvpBalance.add(poolCvpReward);
        }
        if (newLastUpdateBlock > 0) {
            pool.lastUpdateBlock = newLastUpdateBlock;
        }
    }

    function vestUserCvp(User storage user, uint256 accCvpPerLpt) internal returns (uint256) {
        (
            uint256 newlyEntitled,
            uint256 newlyVested,
            uint256 entitled,
            uint256 vested,
            uint32 vestingBlock
        ) = computeCvpVesting(user, accCvpPerLpt);

        if (vestingBlock != 0) {
            user.vestingBlock = vestingBlock;
        }
        if (newlyVested != 0 || newlyEntitled != 0) {
            user.entitledCvp = entitled;
            user.vestingBlock = vestingBlock;
        }
        if (newlyVested != 0) {
            user.vestedCvp = vested;
            transferCvp(msg.sender, newlyVested);
        }

        return newlyVested;
    }

    /* @dev Compute the amount of CVP tokens to be entitled and vested to a user of a pool
     * @param user - user to compute tokens for
     * @param accCvpPerLpt - value of the pool' `pool.accCvpPerLpt`
     * @return newlyEntitled - CVP amount to entitle (on top of `user.entitledCvp` tokens entitled so far)
     * @return newlyVested - CVP amount to vest (on top `user.vestedCvp` tokens already vested)
     * @return entitledCvp - updated value for `user.entitledCvp` (increased by `newlyEntitled`)
     * @return vestedCvp - updated value for `user.vestedCvp` (increased by `newlyVested`)
     * @return vestingBlock - updated value for `user.vestingBlock`
     */
    function computeCvpVesting(User storage _user, uint256 accCvpPerLpt) internal view returns (
        uint256 newlyEntitled,
        uint256 newlyVested,
        uint256 entitledCvp,
        uint256 vestedCvp,
        uint32 vestingBlock
    ) {
        User memory user = _user;
        uint32 age = uint32(block.number) - user.lastUpdateBlock;

        // Tokens which are to be entitled starting from the `user.lastUpdateBlock`, shall be
        // vested proportionally to the number of blocks already minted within the period between
        // the `user.lastUpdateBlock` and `cvpVestingPeriodInBlocks` following the current block
        newlyEntitled = computeCvpToEntitle(user.lptAmount, user.cvpAdjust, accCvpPerLpt);
        uint256 newToVest = newlyEntitled == 0 ? 0 : (
            newlyEntitled.mul(uint256(age)).div(uint256(age + cvpVestingPeriodInBlocks))
        );

        // Tokens which have been pended since the `user.lastUpdateBlock` shall be vested:
        // - in full, if the `user.vestingBlock` has been mined
        // - otherwise, proportionally to the number of blocks already mined so far in the period
        //   between the `user.lastUpdateBlock` and the (not yet mined) `user.vestingBlock`
        uint256 pended = user.entitledCvp >= user.vestedCvp ? 0 : user.entitledCvp.sub(user.vestedCvp);
        uint256 pendedToVest = pended == 0 ? 0 : (
            age >= cvpVestingPeriodInBlocks
                ? pended
                : pended.mul(uint256(age)).div(uint256(cvpVestingPeriodInBlocks))
        );

        newlyVested = pendedToVest.add(newToVest);
        entitledCvp = user.entitledCvp.add(newlyEntitled);
        vestedCvp = user.vestedCvp.add(newlyVested);

        // The vesting period for tokens pending from now, if there are any, is the weighted average
        // between remaining periods to vest "old" pended tokens and newly entitled ones.
        uint256 pending = pended.add(newlyEntitled).sub(newlyVested);
        if (pending == 0) {
            vestingBlock = 0;
        } else {
            uint256 weighted = 0;
            if (pended != 0 && pended > pendedToVest) {
                weighted = pended.sub(pendedToVest)
                    .mul(uint256(cvpVestingPeriodInBlocks - age))
                    .div(uint256(cvpVestingPeriodInBlocks));
            }
            if (newlyEntitled != 0) {
                weighted = newlyEntitled.sub(newToVest).mul(uint256(cvpVestingPeriodInBlocks));
            }
            vestingBlock = uint32(block.number.add(
                    weighted.div(2).div(pending)
            ));
        }

        return (newlyEntitled, newlyVested, entitledCvp, vestedCvp, vestingBlock);
    }

    function computePoolReward(Pool storage pool) private view returns (
        uint256 newAccCvpPerLpt,
        uint256 poolCvpReward,
        uint32 newLastUpdateBlock
    ) {
        uint256 lastUpdateBlock = uint256(pool.lastUpdateBlock);
        if (block.number > lastUpdateBlock) {
            uint256 lptBalance = pool.lpToken.balanceOf(address(this));
            if (lptBalance != 0) {
                uint256 multiplier = getMultiplier(lastUpdateBlock, block.number);
                poolCvpReward = multiplier
                    .mul(cvpPerBlock)
                    .mul(uint256(pool.allocPoint))
                    .div(totalAllocPoint);
                newAccCvpPerLpt = pool.accCvpPerLpt.add(poolCvpReward.mul(SCALE).div(lptBalance));
            }
            newLastUpdateBlock = uint32(block.number);
        }
        return (newAccCvpPerLpt, poolCvpReward, newLastUpdateBlock);
    }

    function computeCvpToEntitle(uint256 userLpt, uint256 userCvpAdjust, uint256 poolAccCvpPerLpt)
    internal pure returns (uint256)
    {
        return userLpt == 0 ? 0 : userLpt.mul(poolAccCvpPerLpt).div(SCALE).sub(userCvpAdjust);
    }

    function safeUint32(uint256 i) private pure returns (uint32) {
        require(i <= 2**32 - 1, "VestedLPMining: unsafe uint32");
        return uint32(i);
    }
}
