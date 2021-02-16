// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@powerpool/poweroracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "../interfaces/IPowerOracle.sol";
import "../PowerIndexPoolController.sol";
import "../balancer-core/BNum.sol";
import "./MCapWeightAbstract.sol";

contract MCapWeightStrategy is MCapWeightAbstract {
  event AddPool(address indexed pool, address indexed poolController);
  event SetPool(address indexed pool, address indexed poolController, bool indexed active);
  event SetWeightsChangeDuration(uint256 weightsChangeDuration);

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

  uint256 weightsChangeDuration;

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

  constructor() public MCapWeightAbstract(address(0)) {}

  function initialize(
    address _oracle,
    address _powerPoke,
    uint256 _weightsChangeDuration
  ) external initializer {
    __Ownable_init();
    oracle = IPowerOracle(_oracle);
    powerPoke = IPowerPoke(_powerPoke);
    weightsChangeDuration = _weightsChangeDuration;
  }

  function setWeightsChangeDuration(uint256 _weightsChangeDuration) external onlyOwner {
    weightsChangeDuration = _weightsChangeDuration;

    emit SetWeightsChangeDuration(_weightsChangeDuration);
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
    for (uint256 pi = 0; pi < _pools.length; pi++) {
      PokeVars memory pv;
      pv.pool = PowerIndexPoolInterface(_pools[pi]);

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
        computeWeightsChange(
          pv.pool,
          pv.tokens,
          pv.minWPS,
          pv.maxWPS,
          pv.fromTimestamp,
          pv.fromTimestamp + weightsChangeDuration
        );

      PowerIndexPoolController.DynamicWeightInput[] memory dws;
      dws = new PowerIndexPoolController.DynamicWeightInput[](lenToPush);

      for (uint256 i = 0; i < pv.tokensLen; i++) {
        uint256 wps =
          getWeightPerSecond(
            weightsChange[i][1],
            weightsChange[i][2],
            pv.fromTimestamp,
            pv.fromTimestamp + weightsChangeDuration
          );

        if (wps > pv.maxWPS) {
          if (weightsChange[i][1] > weightsChange[i][2]) {
            weightsChange[i][2] = bsub(weightsChange[i][1], mul(weightsChangeDuration, pv.maxWPS));
          } else {
            weightsChange[i][2] = badd(weightsChange[i][1], mul(weightsChangeDuration, pv.maxWPS));
          }
        }

        if (wps >= pv.minWPS) {
          if (address(pd.wrapper) == address(0)) {
            dws[pv.iToPush].token = pv.tokens[weightsChange[i][0]];
          } else {
            dws[pv.iToPush].token = pv.piTokens[weightsChange[i][0]];
          }
          dws[pv.iToPush].fromTimestamp = pv.fromTimestamp;
          dws[pv.iToPush].targetTimestamp = pv.fromTimestamp + weightsChangeDuration;
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

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    return powerPoke.getMinMaxReportIntervals(address(this));
  }
}
