pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/EnumerableSet.sol";
import "./interfaces/IVestedLPMining.sol";
import "./lib/SafeUint.sol";

contract VestedLPMining is OwnableUpgradeSafe, ReentrancyGuardUpgradeSafe, IVestedLPMining {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct User {
        uint32 lastUpdateBlock;   // block when the params (below) were updated
        uint32 vestingBlock;      // block by when all entitled CVP tokens to be vested
        uint96 entitledCvp;       // (accumulated) amount of CVPs tokens entitled to the user so far
        uint96 vestedCvp;         // (accumulated) amount of CVPs tokens vested to the user so far
        uint96 cvpAdjust;         // adjustments for computation pending CVP tokens amount
                                  // (with regard to LP token deposits/withdrawals in the past)
        uint256 lptAmount;        // amount of LP tokens the user has provided to a pool
        /** @dev
         * At any time, the amount of CVP tokens entitled to a user but not yet vested is the sum of:
         * (1) CVP tokens entitled after a latest LP token deposit or withdrawal by the user
         *     = (user.lptAmount * pool.accCvpPerLpt) - user.cvpAdjust
         * (2) CVP tokens entitled before the deposit or withdrawal and pending since then
         *     = user.entitledCvp - user.vestedCvp
         *
         * Whenever a user deposits or withdraws LP tokens to a pool:
         *   1. `pool.accCvpPerLpt` for the pool gets updated;
         *   2. CVP token amounts to be entitled and vested to the user get computed;
         *   3. Tokens which may be vested (computed on the previous step) get sent to the user;
         *   3. User' `lptAmount`, `cvpAdjust`, `entitledCvp` and `vestedCvp` get updated.
         *
         * Note comments on vesting rules in the `function computeCvpVesting` code bellow.
         */
    }

    struct Pool {
        IERC20 lpToken;           // address of the LP token contract
        bool votesEnabled;        // if the pool is enabled to write votes
        uint8 poolType;           // pool type (1 - Uniswap, 2 - Balancer)
        uint32 allocPoint;        // points assigned to the pool, which affect CVPs distribution between pools
        uint32 lastUpdateBlock;   // latest block when the pool params which follow was updated
        uint256 accCvpPerLpt;     // accumulated distributed CVPs per one deposited LP token, times 1e12
    }
    // scale factor for `accCvpPerLpt`
    uint256 internal constant SCALE = 1e12;

    // The CVP TOKEN
    IERC20 public cvp;
    // Total amount of CVP tokens pending to be vested to users
    uint96 public cvpVestingPool;
    // Vesting duration in blocks
    uint32 public cvpVestingPeriodInBlocks;
    // Reservoir address
    address public reservoir;
    // The block number when CVP mining starts
    uint256 public startBlock;
    // The amount of CVP tokens rewarded to all pools every block
    uint256 public cvpPerBlock;
    // The migrator contract (only the owner may assign it)
    ILpTokenMigrator public migrator;

    // Params of each pool
    Pool[] public pools;
    // Pid (i.e. the index in `pools`) of each pool by its LP token address
    mapping(address => uint256) public poolPidByAddress;
    // Params of each user that stakes LP tokens, by the Pid and the user address
    mapping (uint256 => mapping (address => User)) public users;
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
        cvpPerBlock = _cvpPerBlock;
        startBlock = _startBlock;
        cvpVestingPeriodInBlocks = _safe32(_cvpVestingPeriodInBlocks);

        emit SetCvpPerBlock(_cvpPerBlock);
    }

    /// @inheritdoc IVestedLPMining
    function poolLength() external view override returns (uint256) {
        return pools.length;
    }

    /// @inheritdoc IVestedLPMining
    function add(uint256 _allocPoint, IERC20 _lpToken, uint8 _poolType, bool _votesEnabled, bool _withUpdate)
    public override onlyOwner
    {
        require(!isLpTokenAdded(_lpToken), "VLPMining: token already added");

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
            allocPoint: _safe32(_allocPoint),
            lastUpdateBlock: uint32(lastUpdateBlock),
            accCvpPerLpt: 0
        }));
        poolPidByAddress[address(_lpToken)] = pid;

        emit AddLpToken(address(_lpToken), pid, _allocPoint);
    }

    /// @inheritdoc IVestedLPMining
    function set(uint256 _pid, uint256 _allocPoint, uint8 _poolType, bool _votesEnabled, bool _withUpdate)
    public override onlyOwner
    {
        if (_withUpdate) {
            updateAllPools();
        }
        totalAllocPoint = totalAllocPoint.sub(uint256(pools[_pid].allocPoint)).add(_allocPoint);
        pools[_pid].allocPoint = _safe32(_allocPoint);
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
        cvpPerBlock = _cvpPerBlock;

        emit SetCvpPerBlock(_cvpPerBlock);
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
        return _to.sub(_from);
    }

    /// @inheritdoc IVestedLPMining
    function pendingCvp(uint256 _pid, address _user) external view override returns (uint256) {
        Pool memory _pool = pools[_pid];
        User storage user = users[_pid][_user];

        computePoolReward(_pool);
        uint96 newlyEntitled = _computeCvpToEntitle(
            user.lptAmount,
            user.cvpAdjust,
            _pool.accCvpPerLpt
        );

        return uint256(SafeUint.add96(
            newlyEntitled,
            _sub96(user.entitledCvp, user.vestedCvp),
            "VLPMining::pendCvp overflow"
        ));
    }

    /// @inheritdoc IVestedLPMining
    function vestableCvp(uint256 _pid, address user) external view override returns (uint256) {
        Pool memory _pool = pools[_pid];
        User memory _user = users[_pid][user];

        computePoolReward(_pool);
        ( , uint256 newlyVested) = computeCvpVesting(_user, _pool.accCvpPerLpt);

        return newlyVested;
    }

    /// @inheritdoc IVestedLPMining
    function isLpTokenAdded(IERC20 _lpToken) public view override returns (bool) {
        uint256 pid = poolPidByAddress[address(_lpToken)];
        return pools.length > pid && address(pools[pid].lpToken) == address(_lpToken);
    }

    /// @inheritdoc IVestedLPMining
    function updateAllPools() public override {
        uint256 length = pools.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    /// @inheritdoc IVestedLPMining
    function updatePool(uint256 _pid) public override nonReentrant {
        Pool storage pool = pools[_pid];
        doPoolUpdate(pool);
    }

    /// @inheritdoc IVestedLPMining
    function deposit(uint256 _pid, uint256 _amount) public override nonReentrant {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][msg.sender];

        doPoolUpdate(pool);
        vestUserCvp(user, pool.accCvpPerLpt);

        if(_amount != 0) {
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            user.lptAmount = user.lptAmount.add(_amount);
        }
        user.cvpAdjust = _computeCvpAdjustment(user.lptAmount, pool.accCvpPerLpt);
        emit Deposit(msg.sender, _pid, _amount);

        doCheckpointVotes(msg.sender);
    }

    /// @inheritdoc IVestedLPMining
    function withdraw(uint256 _pid, uint256 _amount) public override nonReentrant {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][msg.sender];
        require(user.lptAmount >= _amount, "VLPMining: amount exceeds balance");

        doPoolUpdate(pool);
        vestUserCvp(user, pool.accCvpPerLpt);

        if(_amount != 0) {
            user.lptAmount = user.lptAmount.sub(_amount);
            pool.lpToken.safeTransfer(address(msg.sender), _amount);
        }
        user.cvpAdjust = _computeCvpAdjustment(user.lptAmount, pool.accCvpPerLpt);
        emit Withdraw(msg.sender, _pid, _amount);

        doCheckpointVotes(msg.sender);
    }

    /// @inheritdoc IVestedLPMining
    function emergencyWithdraw(uint256 _pid) public override nonReentrant {
        Pool storage pool = pools[_pid];
        User storage user = users[_pid][msg.sender];

        pool.lpToken.safeTransfer(address(msg.sender), user.lptAmount);
        emit EmergencyWithdraw(msg.sender, _pid, user.lptAmount);

        if (user.entitledCvp > user.vestedCvp) {
            // TODO: Make user.entitledCvp be updated as of the pool' lastUpdateBlock
            uint96 pending = _sub96(user.entitledCvp, user.vestedCvp);
            if (pending > cvpVestingPool) {
                cvpVestingPool = _sub96(cvpVestingPool, pending);
            } else {
                cvpVestingPool = 0;
            }
        }

        user.lptAmount = 0;
        user.cvpAdjust = 0;
        user.entitledCvp = 0;
        user.vestedCvp = 0;
        user.vestingBlock = 0;

        doCheckpointVotes(msg.sender);
    }

    /// @inheritdoc IVestedLPMining
    function checkpointVotes(address _user) public override nonReentrant {
        doCheckpointVotes(_user);
    }

    function doCheckpointVotes(address _user) internal {
        uint256 length = pools.length;
        uint256 userPendedCvp = 0;
        uint256 userTotalLpCvp = 0;
        uint256 totalLpCvp = 0;
        for (uint256 pid = 0; pid < length; ++pid) {
            uint256 pending = uint256(_sub96(users[pid][_user].entitledCvp, users[pid][_user].vestedCvp));
            userPendedCvp = userPendedCvp.add(pending);

            Pool storage pool = pools[pid];
            uint256 lpCvp = cvp.balanceOf(address(pool.lpToken));
            totalLpCvp = totalLpCvp.add(lpCvp);

            if (!pool.votesEnabled) {
                continue;
            }

            uint256 lptTotalSupply = pool.lpToken.totalSupply();
            uint256 lptAmount = users[pid][_user].lptAmount;
            if (lptAmount != 0 && lptTotalSupply != 0) {
                uint256 cvpPerLpt = lpCvp.mul(SCALE).div(lptTotalSupply);
                uint256 userLpCvp = lptAmount.mul(cvpPerLpt).div(SCALE);
                userTotalLpCvp = userTotalLpCvp.add(userLpCvp);

                emit CheckpointUserLpVotes(_user, pid, userLpCvp);
            }
        }

        uint256 lpCvpUserShare = (userTotalLpCvp == 0 || totalLpCvp == 0)
            ? 0
            : userTotalLpCvp.mul(SCALE).div(totalLpCvp);

        emit CheckpointTotalLpVotes(totalLpCvp);
        emit CheckpointUserVotes(_user, userPendedCvp, lpCvpUserShare);

//        _write(
//            _user,
//            safe96(userPendedCvp, "VLPMining: Amount overflow"),
//            safe96(lpCvpUserShare, "VLPMining: Amount overflow"),
//            totalLpCvp
//        );
    }

    function transferCvp(address _to, uint256 _amount) internal {
        SafeERC20.safeTransferFrom(cvp, reservoir, _to, _amount);
    }

    /// @dev must be guarded for reentrancy
    function doPoolUpdate(Pool storage pool) internal {
        Pool memory _pool = pool;
        uint32 prevBlock = _pool.lastUpdateBlock;
        uint256 prevAcc = _pool.accCvpPerLpt;

        uint256 cvpReward = computePoolReward(_pool);
        if (cvpReward != 0) {
            cvpVestingPool = SafeUint.add96(
                cvpVestingPool,
                SafeUint.safe96(cvpReward, "VLPMining::doPoolUpdate:1"),
                "VLPMining::doPoolUpdate:2"
            );
        }
        if (_pool.accCvpPerLpt > prevAcc) {
            pool.accCvpPerLpt = _pool.accCvpPerLpt;
        }
        if (_pool.lastUpdateBlock > prevBlock) {
            pool.lastUpdateBlock = _pool.lastUpdateBlock;
        }
    }

    function vestUserCvp(User storage user, uint256 accCvpPerLpt) internal {
        User memory _user = user;
        uint32 prevVestingBlock = _user.vestingBlock;
        uint32 prevUpdateBlock = _user.lastUpdateBlock;
        (uint256 newlyEntitled, uint256 newlyVested) = computeCvpVesting(_user, accCvpPerLpt);

        if (newlyEntitled != 0) {
            user.entitledCvp = _user.entitledCvp;
        }
        if (newlyVested != 0) {
            user.vestedCvp = _user.vestedCvp;
            cvpVestingPool = SafeUint.sub96(
                cvpVestingPool,
                SafeUint.safe96(newlyVested, "VLPMining: unsafe newlyVested"),
                "VLPMining: newlyVested exceeds pool"
            );

            transferCvp(msg.sender, newlyVested);
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
     *   `_user.entitledCvp` gets increased by `newlyEntitled`
     *   `_user.vestedCvp` gets increased by `newlyVested`
     *   `_user.vestingBlock` set to the updated value
     *   `_user.lastUpdateBlock` set to the current block
     *
     * @param _user - user to compute tokens for
     * @param accCvpPerLpt - value of the pool' `pool.accCvpPerLpt`
     * @return newlyEntitled - CVP amount to entitle (on top of `_user.entitledCvp` tokens entitled so far)
     * @return newlyVested - CVP amount to vest (on top `_user.vestedCvp` tokens already vested)
     */
    function computeCvpVesting(User memory _user, uint256 accCvpPerLpt) internal view returns (
        uint256 newlyEntitled,
        uint256 newlyVested
    ) {
        uint32 prevBlock = _user.lastUpdateBlock;
        _user.lastUpdateBlock = uint32(block.number);
        if (prevBlock >= _user.lastUpdateBlock) {
            return (0, 0);
        }

        uint32 age = _user.lastUpdateBlock - prevBlock;

        // Tokens which are to be entitled starting from the `user.lastUpdateBlock`, shall be
        // vested proportionally to the number of blocks already minted within the period between
        // the `user.lastUpdateBlock` and `cvpVestingPeriodInBlocks` following the current block
        newlyEntitled = uint256(_computeCvpToEntitle(_user.lptAmount, _user.cvpAdjust, accCvpPerLpt));
        uint256 newToVest = newlyEntitled == 0 ? 0 : (
            newlyEntitled.mul(uint256(age)).div(uint256(age + cvpVestingPeriodInBlocks))
        );

        // Tokens which have been pended since the `user.lastUpdateBlock` shall be vested:
        // - in full, if the `user.vestingBlock` has been mined
        // - otherwise, proportionally to the number of blocks already mined so far in the period
        //   between the `user.lastUpdateBlock` and the `user.vestingBlock` (not yet mined)
        uint256 pended = _user.vestedCvp >= _user.entitledCvp ? 0 : uint256(_sub96(_user.entitledCvp, _user.vestedCvp));
        age = _user.lastUpdateBlock >= _user.vestingBlock
            ? cvpVestingPeriodInBlocks
            : _user.lastUpdateBlock - prevBlock;
        uint256 pendedToVest = pended == 0 ? 0 : (
            age >= cvpVestingPeriodInBlocks
                ? pended
                : pended.mul(uint256(age)).div(uint256(_user.vestingBlock - prevBlock))
        );

        newlyVested = pendedToVest.add(newToVest);
        _user.entitledCvp = SafeUint.add96(
            _user.entitledCvp,
            uint96(newlyEntitled),
            "VLPMining::computeCvpVes:1"
        );
        _user.vestedCvp = SafeUint.add96(
            _user.vestedCvp,
            SafeUint.safe96(newlyVested, "VLPMining::computeCvpVest:2"),
            "VLPMining::computeCvpVest:3"
        );

        // Amount of CVP token pending to be vested from now
        uint256 remainingPended = pended == 0 ? 0 : pended.sub(pendedToVest);
        uint256 unreleasedNewly = newlyEntitled == 0 ? 0 : newlyEntitled.sub(newlyVested);
        uint256 pending = remainingPended.add(unreleasedNewly);

        // Compute the vesting block (i.e. when the pending tokens to be all vested)
        uint256 period = 0;
        if (pending == 0) {
            // `period` remains 0
        } else if (remainingPended == 0) {
            // only newly entitled CVPs remain pending
            period = cvpVestingPeriodInBlocks;
        } else {
            // "old" CVPs and, perhaps, "new" CVPs are pending - the weighted average applied
            age = _user.vestingBlock - _user.lastUpdateBlock;
            period = (
                (remainingPended.mul(age))
                .add(unreleasedNewly.mul(cvpVestingPeriodInBlocks))
            ).div(pending);
        }
        _user.vestingBlock = _user.lastUpdateBlock + (
            cvpVestingPeriodInBlocks > uint32(period) ? uint32(period) : cvpVestingPeriodInBlocks
        );

        return (newlyEntitled, newlyVested);
    }

    function computePoolReward(Pool memory _pool) internal view returns (uint256 poolCvpReward) {
        poolCvpReward = 0;
        if (block.number > _pool.lastUpdateBlock) {
            uint256 multiplier = getMultiplier(_pool.lastUpdateBlock, block.number);
            _pool.lastUpdateBlock = uint32(block.number);

            uint256 lptBalance = _pool.lpToken.balanceOf(address(this));
            if (lptBalance != 0) {
                poolCvpReward = multiplier
                    .mul(cvpPerBlock)
                    .mul(uint256(_pool.allocPoint))
                    .div(totalAllocPoint);

                _pool.accCvpPerLpt = _pool.accCvpPerLpt.add(poolCvpReward.mul(SCALE).div(lptBalance));
            }
        }
    }

    function _computeCvpToEntitle(uint256 userLpt, uint96 userCvpAdjust, uint256 poolAccCvpPerLpt)
    private pure returns (uint96)
    {
        return userLpt == 0 ? 0 : SafeUint.sub96(
            SafeUint.safe96(userLpt.mul(poolAccCvpPerLpt).div(SCALE), "VLPMining::computeCvp:1"),
            userCvpAdjust,
            "VLPMining::computeCvp:2"
        );
    }

    function _computeCvpAdjustment(uint256 lptAmount, uint256 accCvpPerLpt) private pure returns (uint96) {
        return SafeUint.safe96(
            lptAmount.mul(accCvpPerLpt).div(SCALE),
            "VLPMining::_computeCvpAdj"
        );
    }

    function _sub96(uint96 a, uint96 b) private pure returns (uint96) {
        return SafeUint.sub96(a, b, "VLPMining::_sub96 error");
    }

    function _safe32(uint256 i) private pure returns (uint32) {
        require(i <= 2**32 - 1, "VLPMining: unsafe uint32");
        return uint32(i);
    }
}
