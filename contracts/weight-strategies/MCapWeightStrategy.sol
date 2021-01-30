// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "../interfaces/IPowerOracle.sol";
import "../PowerIndexPoolController.sol";
import "../balancer-core/BNum.sol";

contract MCapWeightStrategy is Ownable, BNum {
  using EnumerableSet for EnumerableSet.AddressSet;

  struct Pool {
    PowerIndexPoolController controller;
    uint256 lastWeightsUpdate;
    mapping(address => uint256) lastTokenMCap;
  }

  EnumerableSet.AddressSet private pools;
  mapping(address => address[]) public excludeTokenBalances;
  mapping(address => Pool) public poolsData;

  IPowerOracle public oracle;
  uint256 dwPeriod;

  struct TokenConfigItem {
    address token;
    address[] excludeTokenBalances;
  }

  event SetExcludeTokenBalances(address indexed token, address[] excludeTokenBalances);
  event FetchTokenMCap(address indexed pool, address indexed token, uint256 mCap);
  event UpdatePoolWeights(
    address indexed pool,
    uint256 indexed timestamp,
    address[] tokens,
    uint256[3][] weightsChange,
    uint256 mCapSum
  );

  constructor(address _oracle, uint256 _dwPeriod) public Ownable() {
    oracle = IPowerOracle(_oracle);
    dwPeriod = _dwPeriod;
  }

  function setExcludeTokenBalances(address _token, address[] calldata _excludeTokenBalances) external onlyOwner {
    excludeTokenBalances[_token] = _excludeTokenBalances;

    emit SetExcludeTokenBalances(_token, _excludeTokenBalances);
  }

  function setExcludeTokenBalancesList(TokenConfigItem[] calldata tokenConfigItems) external onlyOwner {
    uint256 len = tokenConfigItems.length;
    for (uint256 i = 0; i < len; i++) {
      excludeTokenBalances[tokenConfigItems[i].token] = tokenConfigItems[i].excludeTokenBalances;

      emit SetExcludeTokenBalances(tokenConfigItems[i].token, tokenConfigItems[i].excludeTokenBalances);
    }
  }

  function addPool(address _poolAddress, address _controller) external onlyOwner {
    pools.add(_poolAddress);
    poolsData[_poolAddress].controller = PowerIndexPoolController(_controller);
  }

  function poke(address[] memory _pools) external {
    uint256 len = _pools.length;
    for (uint256 i = 0; i < len; i++) {
      PowerIndexPoolInterface pool = PowerIndexPoolInterface(_pools[i]);

      Pool storage pd = poolsData[address(pool)];
      if (pd.lastWeightsUpdate + dwPeriod > block.timestamp) {
        return;
      }
      (uint256 minWPS, uint256 maxWPS) = pool.getWeightPerSecondBounds();

      address[] memory tokens = pool.getCurrentTokens();
      uint256 len = tokens.length;

      uint256 fromTimestamp = block.timestamp + 1;
      uint256 toTimestamp = fromTimestamp + dwPeriod;

      (uint256[3][] memory weightsChange, uint256 lenToPush) =
        _computeWeightsChange(pool, tokens, minWPS, maxWPS, fromTimestamp, toTimestamp);

      PowerIndexPoolController.DynamicWeightInput[] memory dws;
      dws = new PowerIndexPoolController.DynamicWeightInput[](lenToPush);

      uint256 iToPush;
      for (uint256 i = 0; i < len; i++) {
        uint256 wps = _getWeightPerSecond(weightsChange[i][1], weightsChange[i][2], fromTimestamp, toTimestamp);
        if (wps > maxWPS) {
          weightsChange[i][2] = bmul(dwPeriod, maxWPS);
        }
        if (wps >= minWPS) {
          dws[iToPush].token = tokens[weightsChange[i][0]];
          dws[iToPush].fromTimestamp = fromTimestamp;
          dws[iToPush].targetTimestamp = fromTimestamp + dwPeriod;
          dws[iToPush].targetDenorm = weightsChange[i][2];
          iToPush++;
        }
      }

      if (dws.length > 0) {
        pd.controller.setDynamicWeightListByStrategy(dws);
      }

      pd.lastWeightsUpdate = block.timestamp;
    }
  }

  function getTokenMarketCap(address _token) public returns (uint256) {
    uint256 totalSupply = IERC20(_token).totalSupply();
    uint256 len = excludeTokenBalances[_token].length;
    for (uint256 i = 0; i < len; i++) {
      totalSupply = bsub(totalSupply, IERC20(_token).balanceOf(excludeTokenBalances[_token][i]));
    }
    return bdiv(bmul(totalSupply, oracle.assetPrices(_token)), 1 ether);
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
      uint256 newWeight = bdiv(newMCaps[i], newMarketCapSum) * 50;
      weightsChange[i] = [i, oldWeight, newWeight];
    }

    for (uint256 i = 0; i < len; i++) {
      uint256 wps = _getWeightPerSecond(weightsChange[i][1], weightsChange[i][2], fromTimestamp, toTimestamp);
      if (wps >= _minWPS && wps <= _maxWPS) {
        lenToPush++;
      }
    }

    if (lenToPush > 1) {
      sort(weightsChange);
    }

    emit UpdatePoolWeights(address(_pool), block.timestamp, _tokens, weightsChange, newMarketCapSum);
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

  function quickSort(
    uint256[3][] memory wightsChange,
    int256 left,
    int256 right
  ) internal {
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
    if (left < j) quickSort(wightsChange, left, j);
    if (i < right) quickSort(wightsChange, i, right);
  }

  function sort(uint256[3][] memory wightsChange) internal returns (uint256[3][] memory) {
    quickSort(wightsChange, int256(0), int256(wightsChange.length - 1));
    return wightsChange;
  }
}
