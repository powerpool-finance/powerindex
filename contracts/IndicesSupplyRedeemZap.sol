// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@powerpool/power-oracle/contracts/interfaces/IPowerPoke.sol";
import "./interfaces/PowerIndexPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./interfaces/IVault.sol";
import "./interfaces/ICurvePoolRegistry.sol";
import "./interfaces/IErc20PiptSwap.sol";
import "./interfaces/IErc20VaultPoolSwap.sol";

contract IndicesSupplyRedeemZap is OwnableUpgradeSafe {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  event InitRound(
    bytes32 indexed key,
    address indexed pool,
    uint256 endTime,
    address indexed inputToken,
    address outputToken
  );
  event FinishRound(
    bytes32 indexed key,
    address indexed pool,
    address indexed inputToken,
    uint256 totalInputAmount,
    uint256 inputCap,
    uint256 initEndTime,
    uint256 finishEndTime
  );

  event SetFee(address indexed token, uint256 fee);
  event TakeFee(address indexed pool, address indexed token, uint256 amount);
  event ClaimFee(address indexed token, uint256 amount);

  event SetRoundIgnoreOnlyEOA(address msgSender, bool ignore);
  event SetRoundPeriod(uint256 roundPeriod);
  event SetPool(address indexed pool, PoolType pType);
  event SetPiptSwap(address indexed pool, address piptSwap);
  event SetTokenCap(address indexed token, uint256 cap);

  event Deposit(
    bytes32 indexed roundKey,
    address indexed pool,
    address indexed user,
    address inputToken,
    uint256 inputAmount
  );
  event Withdraw(
    bytes32 indexed roundKey,
    address indexed pool,
    address indexed user,
    address inputToken,
    uint256 inputAmount
  );

  event SupplyAndRedeemPoke(
    bytes32 indexed roundKey,
    address indexed pool,
    address indexed inputToken,
    address outputToken,
    uint256 totalInputAmount,
    uint256 totalOutputAmount
  );
  event ClaimPoke(
    bytes32 indexed roundKey,
    address indexed pool,
    address indexed claimFor,
    address inputToken,
    address outputToken,
    uint256 inputAmount,
    uint256 outputAmount
  );

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;
  address public constant ETH = 0x0000000000000000000000000000000000000001;

  IERC20 public immutable usdc;
  IPowerPoke public immutable powerPoke;

  enum PoolType { NULL, PIPT, VAULT }

  mapping(address => PoolType) public poolType;
  mapping(address => address) public poolSwapContract;
  mapping(address => uint256) public tokenCap;
  // TODO: delete on proxy replace
  mapping(address => address[]) public poolTokens;

  // TODO: delete on proxy replace
  struct VaultConfig {
    uint256 depositorLength;
    uint256 depositorIndex;
    address depositor;
    address lpToken;
    address vaultRegistry;
  }
  mapping(address => VaultConfig) public vaultConfig;

  uint256 public roundPeriod;

  // TODO: delete on proxy replace
  address public feeReceiver;
  mapping(address => uint256) public feeByToken;
  mapping(address => uint256) public pendingFeeByToken;

  mapping(address => uint256) public pendingOddTokens;

  struct Round {
    uint256 startBlock;
    address inputToken;
    address outputToken;
    address pool;
    mapping(address => uint256) inputAmount;
    uint256 totalInputAmount;
    mapping(address => uint256) outputAmount;
    uint256 totalOutputAmount;
    uint256 totalOutputAmountClaimed;
    uint256 endTime;
  }
  mapping(bytes32 => Round) public rounds;

  mapping(bytes32 => bytes32) public lastRoundByPartialKey;

  mapping(address => bool) public ignoreOnlyEOA;

  modifier onlyReporter(uint256 _reporterId, bytes calldata _rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeReporter(_reporterId, msg.sender);
    _;
    _reward(_reporterId, gasStart, COMPENSATION_PLAN_1_ID, _rewardOpts);
  }

  modifier onlyNonReporter(uint256 _reporterId, bytes calldata _rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeNonReporter(_reporterId, msg.sender);
    _;
    _reward(_reporterId, gasStart, COMPENSATION_PLAN_1_ID, _rewardOpts);
  }

  modifier onlyEOA() {
    require(tx.origin == msg.sender || ignoreOnlyEOA[msg.sender], "ONLY_EOA");
    _;
  }

  constructor(address _usdc, address _powerPoke) public {
    usdc = IERC20(_usdc);
    powerPoke = IPowerPoke(_powerPoke);
  }

  function initialize(uint256 _roundPeriod) external initializer {
    __Ownable_init();
    roundPeriod = _roundPeriod;
  }

  receive() external payable {
    pendingOddTokens[ETH] = pendingOddTokens[ETH].add(msg.value);
  }

  /* ==========  Client Functions  ========== */

  function depositEth(address _pool) external payable onlyEOA {
    require(poolType[_pool] == PoolType.PIPT, "NS_POOL");

    _deposit(_pool, ETH, _pool, msg.value);
  }

  function depositErc20(
    address _pool,
    address _inputToken,
    uint256 _amount
  ) external onlyEOA {
    require(poolType[_pool] != PoolType.NULL, "UP");

    require(_inputToken == address(usdc), "NS_TOKEN");

    _deposit(_pool, _inputToken, _pool, _amount);
  }

  function depositPoolToken(
    address _pool,
    address _outputToken,
    uint256 _poolAmount
  ) external onlyEOA {
    PoolType pType = poolType[_pool];
    require(pType != PoolType.NULL, "UP");

    if (pType == PoolType.PIPT) {
      require(_outputToken == address(usdc) || _outputToken == ETH, "NS_TOKEN");
    } else {
      require(_outputToken == address(usdc), "NS_TOKEN");
    }

    _deposit(_pool, _pool, _outputToken, _poolAmount);
  }

  function withdrawEth(address _pool, uint256 _amount) external onlyEOA {
    require(poolType[_pool] == PoolType.PIPT, "NS_POOL");

    _withdraw(_pool, ETH, _pool, _amount);
  }

  function withdrawErc20(
    address _pool,
    address _outputToken,
    uint256 _amount
  ) external onlyEOA {
    require(poolType[_pool] != PoolType.NULL, "UP");
    require(_outputToken != ETH, "ETH_CANT_BE_OT");

    _withdraw(_pool, _outputToken, _pool, _amount);
  }

  function withdrawPoolToken(
    address _pool,
    address _outputToken,
    uint256 _amount
  ) external onlyEOA {
    PoolType pType = poolType[_pool];
    require(pType != PoolType.NULL, "UP");

    if (pType == PoolType.PIPT) {
      require(_outputToken == address(usdc) || _outputToken == ETH, "NS_TOKEN");
    } else {
      require(_outputToken == address(usdc), "NS_TOKEN");
    }

    _withdraw(_pool, _pool, _outputToken, _amount);
  }

  /* ==========  Poker Functions  ========== */

  function supplyAndRedeemPokeFromReporter(
    uint256 _reporterId,
    bytes32[] memory _roundKeys,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) onlyEOA {
    _supplyAndRedeemPoke(_roundKeys, false);
  }

  function supplyAndRedeemPokeFromSlasher(
    uint256 _reporterId,
    bytes32[] memory _roundKeys,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) onlyEOA {
    _supplyAndRedeemPoke(_roundKeys, true);
  }

  function claimPokeFromReporter(
    uint256 _reporterId,
    bytes32 _roundKey,
    address[] memory _claimForList,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) onlyEOA {
    _claimPoke(_roundKey, _claimForList, false);
  }

  function claimPokeFromSlasher(
    uint256 _reporterId,
    bytes32 _roundKey,
    address[] memory _claimForList,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) onlyEOA {
    _claimPoke(_roundKey, _claimForList, true);
  }

  /* ==========  Owner Functions  ========== */

  function setIgnoreOnlyEOA(address _msgSender, bool _ignore) external onlyOwner {
    ignoreOnlyEOA[_msgSender] = _ignore;
    emit SetRoundIgnoreOnlyEOA(_msgSender, _ignore);
  }

  function setRoundPeriod(uint256 _roundPeriod) external onlyOwner {
    roundPeriod = _roundPeriod;
    emit SetRoundPeriod(roundPeriod);
  }

  function setPools(address[] memory _pools, PoolType[] memory _types) external onlyOwner {
    uint256 len = _pools.length;
    require(len == _types.length, "L");
    for (uint256 i = 0; i < len; i++) {
      poolType[_pools[i]] = _types[i];
      _updatePool(_pools[i]);
      emit SetPool(_pools[i], _types[i]);
    }
  }

  function setPoolsSwapContracts(address[] memory _pools, address[] memory _swapContracts) external onlyOwner {
    uint256 len = _pools.length;
    require(len == _swapContracts.length, "L");
    for (uint256 i = 0; i < len; i++) {
      poolSwapContract[_pools[i]] = _swapContracts[i];
      usdc.approve(_swapContracts[i], uint256(-1));
      IERC20(_pools[i]).approve(_swapContracts[i], uint256(-1));
      emit SetPiptSwap(_pools[i], _swapContracts[i]);
    }
  }

  function setTokensCap(address[] memory _tokens, uint256[] memory _caps) external onlyOwner {
    uint256 len = _tokens.length;
    require(len == _caps.length, "L");
    for (uint256 i = 0; i < len; i++) {
      tokenCap[_tokens[i]] = _caps[i];
      emit SetTokenCap(_tokens[i], _caps[i]);
    }
  }

  function updatePools(address[] memory _pools) external onlyOwner {
    uint256 len = _pools.length;
    for (uint256 i = 0; i < len; i++) {
      _updatePool(_pools[i]);
    }
  }

  /* ==========  View Functions  ========== */

  function getCurrentBlockRoundKey(
    address pool,
    address inputToken,
    address outputToken
  ) public view returns (bytes32) {
    return getRoundKey(block.number, pool, inputToken, outputToken);
  }

  function getRoundKey(
    uint256 blockNumber,
    address pool,
    address inputToken,
    address outputToken
  ) public view returns (bytes32) {
    return keccak256(abi.encodePacked(blockNumber, pool, inputToken, outputToken));
  }

  function getRoundPartialKey(
    address pool,
    address inputToken,
    address outputToken
  ) public view returns (bytes32) {
    return keccak256(abi.encodePacked(pool, inputToken, outputToken));
  }

  function getLastRoundKey(
    address pool,
    address inputToken,
    address outputToken
  ) external view returns (bytes32) {
    return lastRoundByPartialKey[getRoundPartialKey(pool, inputToken, outputToken)];
  }

  function isRoundReadyToExecute(bytes32 roundKey) public view returns (bool) {
    Round storage round = rounds[roundKey];
    if (tokenCap[round.inputToken] == 0) {
      return round.endTime <= block.timestamp;
    }
    if (round.totalInputAmount == 0) {
      return false;
    }
    return round.totalInputAmount >= tokenCap[round.inputToken] || round.endTime <= block.timestamp;
  }

  function getRoundUserInput(bytes32 roundKey, address user) external view returns (uint256) {
    return rounds[roundKey].inputAmount[user];
  }

  function getRoundUserOutput(bytes32 roundKey, address user) external view returns (uint256) {
    return rounds[roundKey].outputAmount[user];
  }

  /* ==========  Internal Functions  ========== */

  function _deposit(
    address _pool,
    address _inputToken,
    address _outputToken,
    uint256 _amount
  ) internal {
    require(_amount > 0, "NA");
    bytes32 roundKey = _updateRound(_pool, _inputToken, _outputToken);

    if (_inputToken != ETH) {
      IERC20(_inputToken).safeTransferFrom(msg.sender, address(this), _amount);
    }

    Round storage round = rounds[roundKey];
    round.inputAmount[msg.sender] = round.inputAmount[msg.sender].add(_amount);
    round.totalInputAmount = round.totalInputAmount.add(_amount);

    require(round.inputAmount[msg.sender] == 0 || round.inputAmount[msg.sender] > 1e5, "MIN_INPUT");

    emit Deposit(roundKey, _pool, msg.sender, _inputToken, _amount);
  }

  function _withdraw(
    address _pool,
    address _inputToken,
    address _outputToken,
    uint256 _amount
  ) internal {
    require(_amount > 0, "NA");
    bytes32 roundKey = _updateRound(_pool, _inputToken, _outputToken);
    Round storage round = rounds[roundKey];

    round.inputAmount[msg.sender] = round.inputAmount[msg.sender].sub(_amount);
    round.totalInputAmount = round.totalInputAmount.sub(_amount);

    require(round.inputAmount[msg.sender] == 0 || round.inputAmount[msg.sender] > 1e5, "MIN_INPUT");

    if (_inputToken == ETH) {
      msg.sender.transfer(_amount);
    } else {
      IERC20(_inputToken).safeTransfer(msg.sender, _amount);
    }

    emit Withdraw(roundKey, _pool, msg.sender, _inputToken, _amount);
  }

  function _supplyAndRedeemPoke(bytes32[] memory _roundKeys, bool _bySlasher) internal {
    (uint256 minInterval, uint256 maxInterval) = _getMinMaxReportInterval();

    uint256 len = _roundKeys.length;
    require(len > 0, "L");

    for (uint256 i = 0; i < len; i++) {
      Round storage round = rounds[_roundKeys[i]];

      _updateRound(round.pool, round.inputToken, round.outputToken);
      _checkRoundBeforeExecute(_roundKeys[i], round);

      require(round.endTime + minInterval <= block.timestamp, "MIN_I");
      if (_bySlasher) {
        require(round.endTime + maxInterval <= block.timestamp, "MAX_I");
      }

      require(round.inputToken == round.pool || round.outputToken == round.pool, "UA");

      if (round.inputToken == round.pool) {
        _redeemPool(round, round.totalInputAmount);
      } else {
        _supplyPool(round, round.totalInputAmount);
      }

      require(round.totalOutputAmount != 0, "NULL_TO");

      emit SupplyAndRedeemPoke(
        _roundKeys[i],
        round.pool,
        round.inputToken,
        round.outputToken,
        round.totalInputAmount,
        round.totalOutputAmount
      );
    }
  }

  function _supplyPool(Round storage round, uint256 totalInputAmount) internal {
    PoolType pType = poolType[round.pool];
    if (pType == PoolType.PIPT) {
      IErc20PiptSwap piptSwap = IErc20PiptSwap(payable(poolSwapContract[round.pool]));
      if (round.inputToken == ETH) {
        (round.totalOutputAmount, ) = piptSwap.swapEthToPipt{ value: totalInputAmount }(
          piptSwap.defaultSlippage(),
          0,
          piptSwap.defaultDiffPercent()
        );
      } else {
        round.totalOutputAmount = piptSwap.swapErc20ToPipt(
          round.inputToken,
          totalInputAmount,
          piptSwap.defaultSlippage(),
          0,
          piptSwap.defaultDiffPercent()
        );
      }
    } else if (pType == PoolType.VAULT) {
      IErc20VaultPoolSwap vaultPoolSwap = IErc20VaultPoolSwap(poolSwapContract[round.pool]);
      round.totalOutputAmount = vaultPoolSwap.swapErc20ToVaultPool(round.pool, address(usdc), totalInputAmount);
    }
  }

  function _redeemPool(Round storage round, uint256 totalInputAmount) internal {
    PoolType pType = poolType[round.pool];
    if (pType == PoolType.PIPT) {
      IErc20PiptSwap piptSwap = IErc20PiptSwap(payable(poolSwapContract[round.pool]));
      if (round.inputToken == ETH) {
        round.totalOutputAmount = piptSwap.swapPiptToEth(totalInputAmount);
      } else {
        round.totalOutputAmount = piptSwap.swapPiptToErc20(round.outputToken, totalInputAmount);
      }
    } else if (pType == PoolType.VAULT) {
      IErc20VaultPoolSwap vaultPoolSwap = IErc20VaultPoolSwap(poolSwapContract[round.pool]);
      round.totalOutputAmount = vaultPoolSwap.swapVaultPoolToErc20(round.pool, totalInputAmount, address(usdc));
    }
  }

  function _claimPoke(
    bytes32 _roundKey,
    address[] memory _claimForList,
    bool _bySlasher
  ) internal {
    (uint256 minInterval, uint256 maxInterval) = _getMinMaxReportInterval();

    uint256 len = _claimForList.length;
    require(len > 0, "L");

    Round storage round = rounds[_roundKey];
    require(round.endTime + minInterval <= block.timestamp, "MIN_I");
    if (_bySlasher) {
      require(round.endTime + maxInterval <= block.timestamp, "MAX_I");
    }
    require(round.totalOutputAmount != 0, "NULL_TO");

    for (uint256 i = 0; i < len; i++) {
      address _claimFor = _claimForList[i];
      require(round.inputAmount[_claimFor] != 0, "INPUT_NULL");
      require(round.outputAmount[_claimFor] == 0, "OUTPUT_NOT_NULL");

      uint256 inputShare = round.inputAmount[_claimFor].mul(1 ether).div(round.totalInputAmount);
      uint256 outputAmount = round.totalOutputAmount.mul(inputShare).div(1 ether);
      round.outputAmount[_claimFor] = outputAmount;
      round.totalOutputAmountClaimed = round.totalOutputAmountClaimed.add(outputAmount).add(10);
      IERC20(round.outputToken).safeTransfer(_claimFor, outputAmount - 1);

      emit ClaimPoke(
        _roundKey,
        round.pool,
        _claimFor,
        round.inputToken,
        round.outputToken,
        round.inputAmount[_claimFor],
        outputAmount
      );
    }
  }

  function _checkRoundBeforeExecute(bytes32 _roundKey, Round storage round) internal {
    bytes32 partialKey = getRoundPartialKey(round.pool, round.inputToken, round.outputToken);

    require(lastRoundByPartialKey[partialKey] != _roundKey, "CUR_ROUND");
    require(round.totalInputAmount != 0, "TI_NULL");
    require(round.totalOutputAmount == 0, "TO_NOT_NULL");
  }

  function _updateRound(
    address _pool,
    address _inputToken,
    address _outputToken
  ) internal returns (bytes32 roundKey) {
    bytes32 partialKey = getRoundPartialKey(_pool, _inputToken, _outputToken);
    roundKey = lastRoundByPartialKey[partialKey];

    if (roundKey == bytes32(0) || isRoundReadyToExecute(roundKey)) {
      if (roundKey != bytes32(0)) {
        emit FinishRound(
          roundKey,
          _pool,
          _inputToken,
          rounds[roundKey].totalInputAmount,
          tokenCap[_inputToken],
          rounds[roundKey].endTime,
          block.timestamp
        );
        rounds[roundKey].endTime = block.timestamp;
      }
      roundKey = getCurrentBlockRoundKey(_pool, _inputToken, _outputToken);
      rounds[roundKey].startBlock = block.number;
      rounds[roundKey].pool = _pool;
      rounds[roundKey].inputToken = _inputToken;
      rounds[roundKey].outputToken = _outputToken;
      rounds[roundKey].endTime = block.timestamp.add(roundPeriod);
      lastRoundByPartialKey[partialKey] = roundKey;
      emit InitRound(roundKey, _pool, rounds[roundKey].endTime, _inputToken, _outputToken);
    }

    return roundKey;
  }

  function _updatePool(address _pool) internal {
    poolTokens[_pool] = PowerIndexPoolInterface(_pool).getCurrentTokens();
    if (poolType[_pool] == PoolType.VAULT) {
      uint256 len = poolTokens[_pool].length;
      for (uint256 i = 0; i < len; i++) {
        IERC20(poolTokens[_pool][i]).approve(_pool, uint256(-1));
      }
    }
  }

  function _reward(
    uint256 _reporterId,
    uint256 _gasStart,
    uint256 _compensationPlan,
    bytes calldata _rewardOpts
  ) internal {
    powerPoke.reward(_reporterId, _gasStart.sub(gasleft()), _compensationPlan, _rewardOpts);
  }

  function _getMinMaxReportInterval() internal view virtual returns (uint256 min, uint256 max) {
    (min, max) = powerPoke.getMinMaxReportIntervals(address(this));
    min = min == 1 ? 0 : min;
  }
}
