// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "../balancer-core/BNum.sol";
import "../interfaces/PowerIndexPoolInterface.sol";
import "../interfaces/IPowerOracle.sol";

abstract contract WeightValueAbstract is BNum, OwnableUpgradeSafe {
  event UpdatePoolWeights(
    address indexed pool,
    uint256 indexed timestamp,
    address[] tokens,
    uint256[3][] weightsChange,
    uint256[] newTokenValues
  );

  event SetTotalWeight(uint256 totalWeight);

  struct TokenConfigItem {
    address token;
    address[] excludeTokenBalances;
  }

  IPowerOracle public oracle;
  uint256 public totalWeight;

  function getTokenValue(PowerIndexPoolInterface _pool, address _token) public view virtual returns (uint256) {
    return getTVL(_pool, _token);
  }

  function getTVL(PowerIndexPoolInterface _pool, address _token) public view returns (uint256) {
    uint256 balance = _pool.getBalance(_token);
    return bdiv(bmul(balance, oracle.assetPrices(_token)), 1 ether);
  }

  function setTotalWeight(uint256 _totalWeight) external onlyOwner {
    totalWeight = _totalWeight;
    emit SetTotalWeight(_totalWeight);
  }

  function _computeWeightsChangeWithEvent(
    PowerIndexPoolInterface _pool,
    address[] memory _tokens,
    address[] memory _piTokens,
    uint256 _minWPS,
    uint256 _maxWPS,
    uint256 fromTimestamp,
    uint256 toTimestamp
  )
    internal
    returns (
      uint256[3][] memory weightsChange,
      uint256 lenToPush,
      uint256[] memory newTokensValues
    )
  {
    (weightsChange, lenToPush, newTokensValues, ) = computeWeightsChange(
      _pool,
      _tokens,
      _piTokens,
      _minWPS,
      _maxWPS,
      fromTimestamp,
      toTimestamp
    );
    emit UpdatePoolWeights(address(_pool), block.timestamp, _tokens, weightsChange, newTokensValues);
  }

  function computeWeightsChange(
    PowerIndexPoolInterface _pool,
    address[] memory _tokens,
    address[] memory _piTokens,
    uint256 _minWPS,
    uint256 _maxWPS,
    uint256 fromTimestamp,
    uint256 toTimestamp
  )
    public
    view
    returns (
      uint256[3][] memory weightsChange,
      uint256 lenToPush,
      uint256[] memory newTokenValues,
      uint256 newTokenValueSum
    )
  {
    uint256 len = _tokens.length;
    newTokenValues = new uint256[](len);

    for (uint256 i = 0; i < len; i++) {
      uint256 value = getTokenValue(_pool, _tokens[i]);
      newTokenValues[i] = value;
      newTokenValueSum = badd(newTokenValueSum, value);
    }

    weightsChange = new uint256[3][](len);
    for (uint256 i = 0; i < len; i++) {
      uint256 oldWeight;
      if (_piTokens.length == _tokens.length) {
        try _pool.getDenormalizedWeight(_piTokens[i]) returns(uint256 _weight) {
          oldWeight = _weight;
        } catch {
          oldWeight = 0;
        }
      } else {
        oldWeight = _pool.getDenormalizedWeight(_tokens[i]);
      }
      uint256 newWeight = bmul(bdiv(newTokenValues[i], newTokenValueSum), totalWeight);
      weightsChange[i] = [i, oldWeight, newWeight];
    }

    for (uint256 i = 0; i < len; i++) {
      uint256 wps = getWeightPerSecond(weightsChange[i][1], weightsChange[i][2], fromTimestamp, toTimestamp);
      if (wps >= _minWPS) {
        lenToPush++;
      }
    }

    if (lenToPush > 1) {
      _sort(weightsChange);
    }
  }

  function getWeightPerSecond(
    uint256 fromDenorm,
    uint256 targetDenorm,
    uint256 fromTimestamp,
    uint256 targetTimestamp
  ) public pure returns (uint256) {
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

  function mul(uint256 a, uint256 b) internal pure returns (uint256) {
    if (a == 0) {
      return 0;
    }

    uint256 c = a * b;
    require(c / a == b, "SafeMath: multiplication overflow");

    return c;
  }
}
