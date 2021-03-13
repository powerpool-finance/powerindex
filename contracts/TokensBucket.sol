// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IPowerIndexPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "../cache/MCapWeightStrategy.sol";
import "./Erc20PiptSwap.sol";

contract TokensBucket is OwnableUpgradeSafe {
  using SafeMath for uint256;

  event NewRound(uint256 indexed id, uint256 createdAt);
  event InitRoundKey(bytes32 indexed key, address indexed pool, address indexed imputToken);

  TokenInterface public immutable weth;
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

  struct Round {
    uint256 id;
    address inputToken;
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

  constructor(address _weth, address _usdt, address _usdc, address _powerPoke) public {
    weth = TokenInterface(_weth);
    usdt = IERC20(_usdt);
    usdc = IERC20(_usdc);
    powerPoke = IPowerPoke(_powerPoke);
  }

  function initialize() external initializer {
    __Ownable_init();
  }

  function depositEth(address _pool) external payable {
    require(poolType[_pool] != PoolType.NULL, "UNKNOWN_POOL");

    _deposit(_pool, weth, msg.value);
  }

  function depositErc20(address _pool, address _inputToken, uint256 _amount) external {
    PoolType pType = poolType[_pool];
    require(pType != PoolType.NULL, "UNKNOWN_POOL");

    if (pType == PoolType.PIPT) {
      require(_inputToken == usdt, "NOT_SUPPORTED_TOKEN");
    } else if(pType == PoolType.VAULT) {
      require(_inputToken == usdc, "NOT_SUPPORTED_TOKEN");
    }

    _deposit(_pool, weth, _amount);
  }

  function pokeFromReporter(bytes32[] memory _roundKeys) {
    uint256 len = _roundKeys.length;
    require(len > 0, "KEYS_LENGTH_IS_NULL");

    for (uint256 i = 0; i < len; i++) {
      Round storage round = rounds[_roundKeys[i]];
      require(round.id != roundCounter, "CURRENT_ROUND");
      require(round.totalInputAmount != 0, "TOTAL_INPUT_NULL");
      require(round.totalOutputAmount == 0, "TOTAL_OUTPUT_NOT_NULL");

      PoolType pType = poolType[round.pool];
      if (pType == PoolType.PIPT) {
        Erc20PiptSwap piptSwap = poolPiptSwap[round.pool];
        if (round.inputToken == weth) {
          (round.totalOutputAmount, ) = piptSwap.swapEthToPipt{value: round.totalInputAmount}(piptSwap.defaultSlippage());
        } else {
          round.totalOutputAmount = piptSwap.swapErc20ToPipt(usdt, round.totalInputAmount, piptSwap.defaultSlippage());
        }
      }
    }
  }

  function claim(bytes32[] memory _roundKeys) external {
    uint256 len = _roundKeys.length;
    require(len > 0, "KEYS_LENGTH_IS_NULL");

    for (uint256 i = 0; i < len; i++) {
      Round storage round = rounds[_roundKeys[i]];
      require(round.inputAmount[msg.sender] != 0, "INPUT_NULL");
      require(round.outputAmount[msg.sender] != 0, "OUTPUT_NOT_NULL");
      require(round.totalOutputAmount != 0, "TOTAL_OUTPUT_NULL");

      uint256 inputShare = round.inputAmount[msg.sender].mul(1 ether).div(round.totalInputAmount);
      uint256 outputAmount = round.totalOutputAmount.mul(inputShare).div(1 ether);
      round.outputAmount[msg.sender] = outputAmount;
      IERC20(round.pool).transfer(msg.sender, outputAmount);
    }
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
    }
  }

  function updatePools(address[] memory _pools) external onlyOwner {
    uint256 len = _pools.length;
    for (uint256 i = 0; i < len; i++) {
      _updatePool(_pools[i]);
    }
  }

  function getCurrentRoundKey(address pool, address inputToken) public view returns(bytes32) {
    return getRoundKey(roundCounter, pool, inputToken);
  }

  function getRoundKey(uint256 id, address pool, address inputToken) public view returns(bytes32) {
    return keccak256(abi.encodePacked(id, pool, inputToken));
  }

  function _deposit(address _pool, address _inputToken, uint256 _amount) internal {
    _updateRoundByPeriod();

    bytes32 roundKey = getCurrentRoundKey();
    _initRoundData(roundKey, _pool, _inputToken);

    rounds[roundKey].inputAmount[msg.sender] = rounds[roundKey].inputAmount[msg.sender].add(_amount);
    rounds[roundKey].totalInputAmount = rounds[roundKey].totalInputAmount.add(_amount);
  }

  function _updateRoundByPeriod() internal {
    if (lastRoundCreatedAt.add(roundPeriod) <= block.timestamp) {
      roundCounter = roundCounter.add(1);
      lastRoundCreatedAt = block.timestamp;
      emit NewRound(roundCounter, lastRoundCreatedAt);
    }
  }

  function _initRoundData(bytes32 _roundKey, address _pool, address _inputToken) internal {
    if (rounds[_roundKey].pool == address(0)) {
      rounds[_roundKey].id = roundCounter;
      rounds[_roundKey].pool = _pool;
      rounds[_roundKey].inputToken = _inputToken;
      emit InitRoundKey(_roundKey, _pool, _inputToken);
    }
  }

  function _updatePool(address _pool) internal {
    poolTokens[_pool] = IPowerIndexPoolInterface(_pool).getCurrentTokens();
  }

  function _reward(
    uint256 _reporterId,
    uint256 _gasStart,
    uint256 _compensationPlan,
    bytes calldata _rewardOpts
  ) internal {
    powerPoke.reward(_reporterId, bsub(_gasStart, gasleft()), _compensationPlan, _rewardOpts);
  }

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    return powerPoke.getMinMaxReportIntervals(address(this));
  }
}
