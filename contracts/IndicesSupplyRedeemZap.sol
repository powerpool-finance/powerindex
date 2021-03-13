// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@powerpool/poweroracle/contracts/interfaces/IPowerPoke.sol";
import "./interfaces/PowerIndexPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./Erc20PiptSwap.sol";

contract IndicesSupplyRedeemZap is OwnableUpgradeSafe {
  using SafeMath for uint256;

  event NewRound(uint256 indexed id, uint256 createdAt);
  event InitRoundKey(bytes32 indexed key, address indexed pool, address indexed inputToken, address outputToken);
  event SetFee(uint256 fee);

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;
  address public constant ETH = 0x0000000000000000000000000000000000000001;

  IERC20 public immutable usdt;
  IERC20 public immutable usdc;
  IPowerPoke public immutable powerPoke;

  enum PoolType {
    NULL,
    PIPT,
    VAULT
  }

  mapping(address => PoolType) public poolType;
  mapping(address => address) public poolPiptSwap;
  mapping(address => address[]) public poolTokens;

  uint256 public roundCounter;
  uint256 public lastRoundCreatedAt;
  uint256 public roundPeriod;

  mapping(address => uint256) public feeByToken;
  mapping(address => uint256) public pendingFeeByToken;

  struct Round {
    uint256 id;
    address inputToken;
    address outputToken;
    address pool;
    mapping(address => uint256) inputAmount;
    uint256 totalInputAmount;
    mapping(address => uint256) outputAmount;
    uint256 totalOutputAmount;
  }
  mapping(bytes32 => Round) public rounds;

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

  constructor(address _usdt, address _usdc, address _powerPoke) public {
    usdt = IERC20(_usdt);
    usdc = IERC20(_usdc);
    powerPoke = IPowerPoke(_powerPoke);
  }

  function initialize() external initializer {
    __Ownable_init();
  }

  function depositEth(address _pool) external payable {
    require(poolType[_pool] != PoolType.NULL, "UNKNOWN_POOL");

    _deposit(_pool, ETH, _pool, msg.value);
  }

  function depositErc20(address _pool, address _inputToken, uint256 _amount) external {
    PoolType pType = poolType[_pool];
    require(pType != PoolType.NULL, "UNKNOWN_POOL");

    if (pType == PoolType.PIPT) {
      require(_inputToken == address(usdt), "NOT_SUPPORTED_TOKEN");
    } else if(pType == PoolType.VAULT) {
      require(_inputToken == address(usdc), "NOT_SUPPORTED_TOKEN");
    }

    _deposit(_pool, _inputToken, _pool, _amount);
  }

  function depositPoolToken(address _pool, address _outputToken, uint256 _amount) external {
    PoolType pType = poolType[_pool];
    require(pType != PoolType.NULL, "UNKNOWN_POOL");

    if (pType == PoolType.PIPT) {
      require(_outputToken == address(usdt) || _outputToken == ETH, "NOT_SUPPORTED_TOKEN");
    } else if(pType == PoolType.VAULT) {
      require(_outputToken == address(usdc), "NOT_SUPPORTED_TOKEN");
    }

    _deposit(_pool, _pool, _outputToken, _amount);
  }

  function supplyAndRedeemPokeFromReporter(
    uint256 _reporterId,
    bytes32[] memory _roundKeys,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) {
    _supplyAndRedeemPoke(_roundKeys);
  }

  function supplyAndRedeemPokeFromSlasher(
    uint256 _reporterId,
    bytes32[] memory _roundKeys,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) {
    _supplyAndRedeemPoke(_roundKeys);
  }

  function supplyAndRedeemPoke(bytes32[] memory _roundKeys) external {
    _supplyAndRedeemPoke(_roundKeys);
  }

  function claimPokeFromReporter(
    uint256 _reporterId,
    bytes32 _roundKey,
    address[] memory _claimForList,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) {
    _claimPoke(_roundKey, _claimForList);
  }

  function claimPokeFromSlasher(
    uint256 _reporterId,
    bytes32 _roundKey,
    address[] memory _claimForList,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) {
    _claimPoke(_roundKey, _claimForList);
  }

  function claimPoke(bytes32 _roundKey, address[] memory _claimForList) external {
    _claimPoke(_roundKey, _claimForList);
  }

  function setPools(address[] memory _pools, PoolType[] memory _types) external onlyOwner {
    uint256 len = _pools.length;
    require(len == _types.length, "LENGTHS_NOT_EQUAL");
    for (uint256 i = 0; i < len; i++) {
      poolType[_pools[i]] = _types[i];
      _updatePool(_pools[i]);
    }
  }

  function setPoolsPiptSwap(address[] memory _pools, address[] memory _piptSwaps) external onlyOwner {
    uint256 len = _pools.length;
    require(len == _piptSwaps.length, "LENGTHS_NOT_EQUAL");
    for (uint256 i = 0; i < len; i++) {
      poolPiptSwap[_pools[i]] = _piptSwaps[i];
      usdt.approve(_piptSwaps[i], uint256(-1));
      IERC20(_pools[i]).approve(_piptSwaps[i], uint256(-1));
    }
  }

  function updatePools(address[] memory _pools) external onlyOwner {
    uint256 len = _pools.length;
    for (uint256 i = 0; i < len; i++) {
      _updatePool(_pools[i]);
    }
  }

  function setFee(address[] memory _tokens, uint256[] memory _fees) external onlyOwner {
    uint256 len = _tokens.length;
    require(len == _fees.length, "LENGTHS_NOT_EQUAL");
    for (uint256 i = 0; i < len; i++) {
      feeByToken[_tokens[i]] = _fees[i];
    }
  }

  function getCurrentRoundKey(address pool, address inputToken) public view returns(bytes32) {
    return getRoundKey(roundCounter, pool, inputToken);
  }

  function getRoundKey(uint256 id, address pool, address inputToken) public view returns(bytes32) {
    return keccak256(abi.encodePacked(id, pool, inputToken));
  }

  function _deposit(address _pool, address _inputToken, address _outputToken, uint256 _amount) internal {
    _updateRoundByPeriod();

    bytes32 roundKey = getCurrentRoundKey(_pool, _inputToken);
    _initRoundData(roundKey, _pool, _inputToken, _outputToken);

    if (_inputToken != ETH) {
      IERC20(_inputToken).transferFrom(msg.sender, address(this), _amount);
    }

    Round storage round = rounds[roundKey];
    round.inputAmount[msg.sender] = round.inputAmount[msg.sender].add(_amount);
    round.totalInputAmount = round.totalInputAmount.add(_amount);
  }

  function _supplyAndRedeemPoke(bytes32[] memory _roundKeys) internal {
    uint256 len = _roundKeys.length;
    require(len > 0, "NULL_LENGTH");

    for (uint256 i = 0; i < len; i++) {
      Round storage round = rounds[_roundKeys[i]];
      _checkRoundBeforeExecute(round);

      uint256 inputAmountWithFee = _takeAmountFee(round.inputToken, round.totalInputAmount);
      require(round.inputToken == round.pool || round.outputToken == round.pool, "UNKNOWN_ROUND_ACTION");

      if (round.inputToken == round.pool) {
        _redeemPool(round, inputAmountWithFee);
      } else {
        _supplyPool(round, inputAmountWithFee);
      }
    }
  }

  function _supplyPool(Round storage round, uint256 inputAmountWithFee) internal {
    PoolType pType = poolType[round.pool];
    if (pType == PoolType.PIPT) {
      Erc20PiptSwap piptSwap = Erc20PiptSwap(payable(poolPiptSwap[round.pool]));
      if (round.inputToken == ETH) {
        (round.totalOutputAmount, ) = piptSwap.swapEthToPipt{ value: inputAmountWithFee }(piptSwap.defaultSlippage());
      } else {
        round.totalOutputAmount = piptSwap.swapErc20ToPipt(round.inputToken, inputAmountWithFee, piptSwap.defaultSlippage());
      }
    }
  }

  function _redeemPool(Round storage round, uint256 inputAmountWithFee) internal {
    PoolType pType = poolType[round.pool];
    if (pType == PoolType.PIPT) {
      Erc20PiptSwap piptSwap = Erc20PiptSwap(payable(poolPiptSwap[round.pool]));
      if (round.inputToken == ETH) {
        round.totalOutputAmount = piptSwap.swapPiptToEth(inputAmountWithFee);
      } else {
        round.totalOutputAmount = piptSwap.swapPiptToErc20(round.inputToken, inputAmountWithFee);
      }
    }
  }

  function _claimPoke(bytes32 _roundKey, address[] memory _claimForList) internal {
    uint256 len = _claimForList.length;
    require(len > 0, "NULL_LENGTH");

    Round storage round = rounds[_roundKey];
    require(round.totalOutputAmount != 0, "TOTAL_OUTPUT_NULL");

    for (uint256 i = 0; i < len; i++) {
      address _claimFor = _claimForList[i];
      require(round.inputAmount[_claimFor] != 0, "INPUT_NULL");
      require(round.outputAmount[_claimFor] == 0, "OUTPUT_NOT_NULL");

      uint256 inputShare = round.inputAmount[_claimFor].mul(1 ether).div(round.totalInputAmount);
      uint256 outputAmount = round.totalOutputAmount.mul(inputShare).div(1 ether);
      round.outputAmount[_claimFor] = outputAmount;
      IERC20(round.pool).transfer(_claimFor, outputAmount - 1);
    }
  }

  function _takeAmountFee(address _inputToken, uint256 _amount) internal returns (uint256 amountWithFee) {
    amountWithFee = _amount.mul(feeByToken[_inputToken]).div(1 ether);
    if (amountWithFee != _amount) {
      pendingFeeByToken[_inputToken] = pendingFeeByToken[_inputToken].add(_amount.sub(amountWithFee));
    }
  }

  function _checkRoundBeforeExecute(Round storage round) internal {
    require(round.id != roundCounter, "CURRENT_ROUND");
    require(round.totalInputAmount != 0, "TOTAL_INPUT_NULL");
    require(round.totalOutputAmount == 0, "TOTAL_OUTPUT_NOT_NULL");
  }

  function _updateRoundByPeriod() internal {
    if (lastRoundCreatedAt.add(roundPeriod) <= block.timestamp) {
      roundCounter = roundCounter.add(1);
      lastRoundCreatedAt = block.timestamp;
      emit NewRound(roundCounter, lastRoundCreatedAt);
    }
  }

  function _initRoundData(bytes32 _roundKey, address _pool, address _inputToken, address _outputToken) internal {
    if (rounds[_roundKey].pool == address(0)) {
      rounds[_roundKey].id = roundCounter;
      rounds[_roundKey].pool = _pool;
      rounds[_roundKey].inputToken = _inputToken;
      rounds[_roundKey].outputToken = _outputToken;
      emit InitRoundKey(_roundKey, _pool, _inputToken, _outputToken);
    }
  }

  function _updatePool(address _pool) internal {
    poolTokens[_pool] = PowerIndexPoolInterface(_pool).getCurrentTokens();
  }

  function _reward(
    uint256 _reporterId,
    uint256 _gasStart,
    uint256 _compensationPlan,
    bytes calldata _rewardOpts
  ) internal {
    powerPoke.reward(_reporterId, _gasStart.sub(gasleft()), _compensationPlan, _rewardOpts);
  }

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    return powerPoke.getMinMaxReportIntervals(address(this));
  }
}
