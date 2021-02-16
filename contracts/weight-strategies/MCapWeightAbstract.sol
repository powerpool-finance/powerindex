// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "../balancer-core/BNum.sol";
import "../interfaces/PowerIndexPoolInterface.sol";
import "../interfaces/IPowerOracle.sol";

contract MCapWeightAbstract is BNum, OwnableUpgradeSafe {
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

  IPowerOracle public oracle;
  mapping(address => address[]) public excludeTokenBalances;

  constructor(address _oracle) public OwnableUpgradeSafe() {
    if (_oracle != address(0)) {
      __Ownable_init();
      oracle = IPowerOracle(_oracle);
    }
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

  function computeWeightsChange(
    PowerIndexPoolInterface _pool,
    address[] memory _tokens,
    uint256 _minWPS,
    uint256 _maxWPS,
    uint256 fromTimestamp,
    uint256 toTimestamp
  ) public returns (uint256[3][] memory weightsChange, uint256 lenToPush) {
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
      uint256 wps = getWeightPerSecond(weightsChange[i][1], weightsChange[i][2], fromTimestamp, toTimestamp);
      if (wps >= _minWPS) {
        lenToPush++;
      }
    }

    if (lenToPush > 1) {
      _sort(weightsChange);
    }

    emit UpdatePoolWeights(address(_pool), block.timestamp, _tokens, weightsChange, newMarketCapSum);
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
