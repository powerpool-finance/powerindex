// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@powerpool/poweroracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "../interfaces/IPowerOracle.sol";
import "../PowerIndexPoolController.sol";
import "../balancer-core/BNum.sol";

contract MCapWeightStrategy is OwnableUpgradeSafe, BNum {
  using EnumerableSet for EnumerableSet.AddressSet;

  event AddPool(address indexed pool, address indexed poolController);
  event SetPool(address indexed pool, address indexed poolController, bool indexed active);
  event SetExcludeTokenBalances(address indexed token, address[] excludeTokenBalances);
  event FetchTokenMCap(address indexed pool, address indexed token, uint256 mCap);
  event UpdatePoolWeights(
    address indexed pool,
    uint256 indexed timestamp,
    address[] tokens,
    uint256[3][] weightsChange,
    uint256 mCapSum
  );

  struct TokenConfigItem {
    address token;
    address[] excludeTokenBalances;
  }

  struct PokeVars {
    PowerIndexPoolInterface pool;
    uint256 minWPS;
    uint256 maxWPS;
    address[] tokens;
    address[] piTokens;
    uint256 tokensLen;
    uint256 fromTimestamp;
    uint256 iToPush;
  }

  struct Pool {
    PowerIndexPoolController controller;
    PowerIndexWrapperInterface wrapper;
    uint256 lastWeightsUpdate;
    bool active;
  }

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;

  address[] public pools;
  mapping(address => Pool) public poolsData;
  mapping(address => address[]) public excludeTokenBalances;

  IPowerOracle public oracle;
  IPowerPoke public powerPoke;

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

  modifier denyContract() {
    require(msg.sender == tx.origin, "CONTRACT_CALL");
    _;
  }

  constructor() public OwnableUpgradeSafe() {}

  function initialize(address _oracle, address _powerPoke) external initializer {
    __Ownable_init();
    oracle = IPowerOracle(_oracle);
    powerPoke = IPowerPoke(_powerPoke);
  }

  function setExcludeTokenBalances(address _token, address[] calldata _excludeTokenBalances) external onlyOwner {
    excludeTokenBalances[_token] = _excludeTokenBalances;

    emit SetExcludeTokenBalances(_token, _excludeTokenBalances);
  }

  function setExcludeTokenBalancesList(TokenConfigItem[] calldata _tokenConfigItems) external onlyOwner {
    uint256 len = _tokenConfigItems.length;
    for (uint256 i = 0; i < len; i++) {
      excludeTokenBalances[_tokenConfigItems[i].token] = _tokenConfigItems[i].excludeTokenBalances;

      emit SetExcludeTokenBalances(_tokenConfigItems[i].token, _tokenConfigItems[i].excludeTokenBalances);
    }
  }

  function addPool(
    address _poolAddress,
    address _controller,
    address _wrapper
  ) external onlyOwner {
    require(address(poolsData[_poolAddress].controller) == address(0), "ALREADY_EXIST");
    require(_controller != address(0), "CONTROLLER_CANT_BE_NULL");
    pools.push(_poolAddress);
    poolsData[_poolAddress].controller = PowerIndexPoolController(_controller);
    poolsData[_poolAddress].wrapper = PowerIndexWrapperInterface(_wrapper);
    poolsData[_poolAddress].active = true;
    emit AddPool(_poolAddress, _controller);
  }

  function setPool(
    address _poolAddress,
    address _controller,
    address _wrapper,
    bool _active
  ) external onlyOwner {
    require(_controller != address(0), "CONTROLLER_CANT_BE_NULL");
    poolsData[_poolAddress].controller = PowerIndexPoolController(_controller);
    poolsData[_poolAddress].wrapper = PowerIndexWrapperInterface(_wrapper);
    poolsData[_poolAddress].active = _active;
    emit SetPool(_poolAddress, _controller, _active);
  }

  function pausePool(address _poolAddress) external onlyOwner {
    poolsData[_poolAddress].active = false;
    PowerIndexPoolInterface pool = PowerIndexPoolInterface(_poolAddress);
    address[] memory tokens = pool.getCurrentTokens();

    uint256 len = tokens.length;
    PowerIndexPoolController.DynamicWeightInput[] memory dws;
    dws = new PowerIndexPoolController.DynamicWeightInput[](len);

    for (uint256 i = 0; i < len; i++) {
      dws[i].token = tokens[i];
      dws[i].fromTimestamp = block.timestamp + 1;
      dws[i].targetTimestamp = block.timestamp + 2;
      dws[i].targetDenorm = pool.getDenormalizedWeight(tokens[i]);
    }

    poolsData[_poolAddress].controller.setDynamicWeightListByStrategy(dws);
  }

  function pokeFromReporter(
    uint256 _reporterId,
    address[] memory _pools,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) denyContract {
    _poke(_pools, false);
  }

  function pokeFromSlasher(
    uint256 _reporterId,
    address[] memory _pools,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) denyContract {
    _poke(_pools, true);
  }

  function getTokenMarketCap(address _token) public view returns (uint256) {
    uint256 totalSupply = IERC20(_token).totalSupply();
    uint256 len = excludeTokenBalances[_token].length;
    for (uint256 i = 0; i < len; i++) {
      totalSupply = bsub(totalSupply, IERC20(_token).balanceOf(excludeTokenBalances[_token][i]));
    }
    return bdiv(bmul(totalSupply, oracle.assetPrices(_token)), 1 ether);
  }

  function getExcludeTokenBalancesLength(address _token) external view returns (uint256) {
    return excludeTokenBalances[_token].length;
  }

  function getExcludeTokenBalancesList(address _token) external view returns (address[] memory) {
    return excludeTokenBalances[_token];
  }

  function getPoolsList() external view returns (address[] memory) {
    return pools;
  }

  function getPoolsLength() external view returns (uint256) {
    return pools.length;
  }

  function getActivePoolsList() external view returns (address[] memory output) {
    uint256 len = pools.length;
    uint256 activeLen = 0;

    for (uint256 i; i < len; i++) {
      if (poolsData[pools[i]].active) {
        activeLen++;
      }
    }

    output = new address[](activeLen);
    uint256 ai;
    for (uint256 i; i < len; i++) {
      if (poolsData[pools[i]].active) {
        output[ai++] = pools[i];
      }
    }
  }

  function _poke(address[] memory _pools, bool _bySlasher) internal {
    (uint256 minInterval, uint256 maxInterval) = _getMinMaxReportInterval();
    for (uint256 i = 0; i < _pools.length; i++) {
      PokeVars memory pv;
      pv.pool = PowerIndexPoolInterface(_pools[i]);

      Pool storage pd = poolsData[address(pv.pool)];
      require(pd.active, "NOT_ACTIVE");
      require(pd.lastWeightsUpdate + minInterval < block.timestamp, "MIN_INTERVAL_NOT_REACHED");
      if (_bySlasher) {
        require(pd.lastWeightsUpdate + maxInterval < block.timestamp, "MAX_INTERVAL_NOT_REACHED");
      }
      (pv.minWPS, pv.maxWPS) = pv.pool.getWeightPerSecondBounds();

      if (address(pd.wrapper) == address(0)) {
        pv.tokens = pv.pool.getCurrentTokens();
      } else {
        pv.tokens = pd.wrapper.getCurrentTokens();
        pv.piTokens = pv.pool.getCurrentTokens();
      }
      pv.tokensLen = pv.tokens.length;

      pv.fromTimestamp = block.timestamp + 1;

      (uint256[3][] memory weightsChange, uint256 lenToPush) =
        _computeWeightsChange(
          pv.pool,
          pv.tokens,
          pv.minWPS,
          pv.maxWPS,
          pv.fromTimestamp,
          pv.fromTimestamp + minInterval
        );

      PowerIndexPoolController.DynamicWeightInput[] memory dws;
      dws = new PowerIndexPoolController.DynamicWeightInput[](lenToPush);

      for (uint256 i = 0; i < pv.tokensLen; i++) {
        uint256 wps =
          _getWeightPerSecond(
            weightsChange[i][1],
            weightsChange[i][2],
            pv.fromTimestamp,
            pv.fromTimestamp + minInterval
          );
        if (wps > pv.maxWPS) {
          weightsChange[i][2] = bmul(minInterval, pv.maxWPS);
        }
        if (wps >= pv.minWPS) {
          if (address(pd.wrapper) == address(0)) {
            dws[pv.iToPush].token = pv.tokens[weightsChange[i][0]];
          } else {
            dws[pv.iToPush].token = pv.piTokens[weightsChange[i][0]];
          }
          dws[pv.iToPush].fromTimestamp = pv.fromTimestamp;
          dws[pv.iToPush].targetTimestamp = pv.fromTimestamp + minInterval;
          dws[pv.iToPush].targetDenorm = weightsChange[i][2];
          pv.iToPush++;
        }
      }

      if (dws.length > 0) {
        pd.controller.setDynamicWeightListByStrategy(dws);
      }

      pd.lastWeightsUpdate = block.timestamp;
    }
  }

  function _reward(
    uint256 _reporterId,
    uint256 _gasStart,
    uint256 _compensationPlan,
    bytes calldata _rewardOpts
  ) internal {
    powerPoke.reward(_reporterId, bsub(_gasStart, gasleft()), _compensationPlan, _rewardOpts);
  }

  function _computeWeightsChange(
    PowerIndexPoolInterface _pool,
    address[] memory _tokens,
    uint256 _minWPS,
    uint256 _maxWPS,
    uint256 fromTimestamp,
    uint256 toTimestamp
  ) internal returns (uint256[3][] memory weightsChange, uint256 lenToPush) {
    uint256 len = _tokens.length;
    uint256[] memory newMCaps = new uint256[](len);

    uint256 newMarketCapSum;
    for (uint256 i = 0; i < len; i++) {
      newMCaps[i] = getTokenMarketCap(_tokens[i]);
      newMarketCapSum = badd(newMarketCapSum, newMCaps[i]);

      emit FetchTokenMCap(address(_pool), _tokens[i], newMCaps[i]);
    }

    weightsChange = new uint256[3][](len);
    for (uint256 i = 0; i < len; i++) {
      (, , , uint256 oldWeight) = _pool.getDynamicWeightSettings(_tokens[i]);
      uint256 newWeight = bmul(bdiv(newMCaps[i], newMarketCapSum), 25 * BONE);
      weightsChange[i] = [i, oldWeight, newWeight];
    }

    for (uint256 i = 0; i < len; i++) {
      uint256 wps = _getWeightPerSecond(weightsChange[i][1], weightsChange[i][2], fromTimestamp, toTimestamp);
      if (wps >= _minWPS) {
        lenToPush++;
      }
    }

    if (lenToPush > 1) {
      _sort(weightsChange);
    }

    emit UpdatePoolWeights(address(_pool), block.timestamp, _tokens, weightsChange, newMarketCapSum);
  }

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    return powerPoke.getMinMaxReportIntervals(address(this));
  }

  function _getWeightPerSecond(
    uint256 fromDenorm,
    uint256 targetDenorm,
    uint256 fromTimestamp,
    uint256 targetTimestamp
  ) internal pure returns (uint256) {
    uint256 delta = targetDenorm > fromDenorm ? bsub(targetDenorm, fromDenorm) : bsub(fromDenorm, targetDenorm);
    return div(delta, bsub(targetTimestamp, fromTimestamp));
  }

  function _quickSort(
    uint256[3][] memory wightsChange,
    int256 left,
    int256 right
  ) internal pure {
    int256 i = left;
    int256 j = right;
    if (i == j) return;
    uint256[3] memory pivot = wightsChange[uint256(left + (right - left) / 2)];
    int256 pDiff = int256(pivot[2]) - int256(pivot[1]);
    while (i <= j) {
      while (int256(wightsChange[uint256(i)][2]) - int256(wightsChange[uint256(i)][1]) < pDiff) i++;
      while (pDiff < int256(wightsChange[uint256(j)][2]) - int256(wightsChange[uint256(j)][1])) j--;
      if (i <= j) {
        (wightsChange[uint256(i)], wightsChange[uint256(j)]) = (wightsChange[uint256(j)], wightsChange[uint256(i)]);
        i++;
        j--;
      }
    }
    if (left < j) _quickSort(wightsChange, left, j);
    if (i < right) _quickSort(wightsChange, i, right);
  }

  function _sort(uint256[3][] memory weightsChange) internal pure {
    _quickSort(weightsChange, int256(0), int256(weightsChange.length - 1));
  }
}
