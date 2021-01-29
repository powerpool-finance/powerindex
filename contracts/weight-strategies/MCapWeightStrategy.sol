// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "../interfaces/IPowerOracle.sol";
import "../PowerIndexPoolController.sol";
import "../balancer-core/BNum.sol";

import "hardhat/console.sol";

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
  event InitTokenMCap(address indexed pool, address indexed token, uint256 mCap);
  event UpdateTokenMCap(address indexed pool, address indexed token, uint256 mCap);

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

  function initializePool(address _poolAddress) public onlyOwner {
    address[] memory tokens = PowerIndexPoolInterface(_poolAddress).getCurrentTokens();
    uint256 len = tokens.length;
    Pool storage pd = poolsData[_poolAddress];
    for (uint256 i = 0; i < len; i++) {
      pd.lastTokenMCap[tokens[i]] = getTokenMarketCap(tokens[i]);
      emit InitTokenMCap(_poolAddress, tokens[i], pd.lastTokenMCap[tokens[i]]);
    }
  }

  function addPool(address _poolAddress, address _controller) external onlyOwner {
    pools.add(_poolAddress);
    poolsData[_poolAddress].controller = PowerIndexPoolController(_controller);
    initializePool(_poolAddress);
  }

  function poke() external {
    uint256 len = pools.length();
    for (uint256 i = 0; i < len; i++) {
      PowerIndexPoolInterface pool = PowerIndexPoolInterface(pools.at(i));

      Pool storage pd = poolsData[address(pool)];
      if (pd.lastWeightsUpdate + dwPeriod > block.timestamp) {
        return;
      }
      (uint256 minWeightPerSecond, uint256 maxWeightPerSecond) = pool.getWeightPerSecondBounds();

      address[] memory tokens = pool.getCurrentTokens();
      uint256 len = tokens.length;
      uint256[] memory oldMCaps = new uint256[](len);
      uint256[] memory newMCaps = new uint256[](len);

      uint256 oldMarketCapSum;
      uint256 newMarketCapSum;
      for (uint256 i = 0; i < len; i++) {
        newMCaps[i] = getTokenMarketCap(tokens[i]);
        newMarketCapSum = badd(newMarketCapSum, newMCaps[i]);
        oldMCaps[i] = pd.lastTokenMCap[tokens[i]];
        if (oldMCaps[i] == 0) {
          oldMCaps[i] = newMCaps[i];
        }
        oldMarketCapSum = badd(oldMarketCapSum, oldMCaps[i]);

        pd.lastTokenMCap[tokens[i]] = newMCaps[i];
        emit UpdateTokenMCap(address(pool), tokens[i], newMCaps[i]);
      }

      uint256[2][] memory wightsChange = new uint256[2][](len);
      for (uint256 i = 0; i < len; i++) {
        (, , , uint256 oldWeight) = pool.getDynamicWeightSettings(tokens[i]);
        uint256 numerator = bmul(bdiv(bmul(newMCaps[i], oldWeight), 1 ether), oldMarketCapSum);
        uint256 newWeight = bdiv(bmul(bdiv(numerator, oldMCaps[i]), 1 ether), newMarketCapSum);
        wightsChange[i] = [oldWeight, newWeight];
      }

      uint256 fromTimestamp = block.timestamp + 1;
      uint256 lenToPush;
      for (uint256 i = 0; i < len; i++) {
        uint256 wps = _getWeightPerSecond(wightsChange[i][0], wightsChange[i][1], fromTimestamp, fromTimestamp + dwPeriod);
        if (wps >= minWeightPerSecond && wps <= maxWeightPerSecond) {
          lenToPush++;
        }
      }
      PowerIndexPoolController.DynamicWeightInput[] memory dws = new PowerIndexPoolController.DynamicWeightInput[](lenToPush);

      uint256 iToPush;
      uint256 totalWeight;
      for (uint256 i = 0; i < len; i++) {
        uint256 wps = _getWeightPerSecond(wightsChange[i][0], wightsChange[i][1], fromTimestamp, fromTimestamp + dwPeriod);
        if (wps >= minWeightPerSecond && wps <= maxWeightPerSecond) {
          dws[iToPush].token = tokens[i];
          dws[iToPush].fromTimestamp = fromTimestamp;
          dws[iToPush].targetTimestamp = fromTimestamp + dwPeriod;
          dws[iToPush].targetDenorm = wightsChange[i][1];
          console.log("dws[iToPush].targetDenorm", dws[iToPush].targetDenorm);
          totalWeight = badd(totalWeight, dws[iToPush].targetDenorm);
          iToPush++;
        }
      }
      console.log("totalWeight", totalWeight);

      pd.controller.setDynamicWeightListByStrategy(dws);

      pd.lastWeightsUpdate = block.timestamp;
    }
  }

  function _updateTokenMCap(address _pool, address _token, uint256 _mCap) internal {
    poolsData[_pool].lastTokenMCap[_token] = _mCap;

    emit UpdateTokenMCap(_pool, _token, _mCap);
  }

  function getTokenMarketCap(address _token) public returns (uint256) {
    uint256 totalSupply = IERC20(_token).totalSupply();
    uint256 len = excludeTokenBalances[_token].length;
    for(uint256 i = 0; i < len; i++) {
      totalSupply = bsub(totalSupply, IERC20(_token).balanceOf(excludeTokenBalances[_token][i]));
    }
    return bdiv(bmul(totalSupply, oracle.assetPrices(_token)), 1 ether);
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
}
