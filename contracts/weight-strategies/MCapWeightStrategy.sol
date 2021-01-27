// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "../interfaces/IPowerOracle.sol";
import "../interfaces/PowerIndexPoolInterface.sol";

contract MCapWeightStrategy is Ownable {
  using SafeMath for uint256;
  using EnumerableSet for EnumerableSet.AddressSet;

  struct WeightConfig {
    uint256 mCap;
    uint256 lastWeightUpdate;
  }

  mapping(address => mapping(address => WeightConfig)) public weightConfig;
  EnumerableSet.AddressSet private pools;
  mapping(address => address[]) public excludeTokenBalances;

  IPowerOracle public oracle;
  uint256 dwPeriod;

  struct TokenConfigItem {
    address token;
    address[] excludeTokenBalances;
  }

  event SetExcludeTokenBalances(address indexed token, address[] _excludeTokenBalances);

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

  function initializePool(address _poolAddress) external onlyOwner {
    address[] memory tokens = PowerIndexPoolInterface(_poolAddress).getCurrentTokens();
    uint256 len = tokens.length;
    for (uint256 i = 0; i < len; i++) {
      weightConfig[_poolAddress][tokens[i]] = WeightConfig(getTokenMarketCap(tokens[i]), block.timestamp);
    }
  }

  function addPool(address _poolAddress) external onlyOwner {
    pools.add(_poolAddress);
  }

  function poke() external {
    uint256 len = pools.length();
    for (uint256 i = 0; i < len; i++) {
      PowerIndexPoolInterface pool = PowerIndexPoolInterface(pools.at(i));

      address[] memory tokens = pool.getCurrentTokens();
      uint256 len = tokens.length;
      for (uint256 i = 0; i < len; i++) {
        if (weightConfig[address(pool)][tokens[i]].lastWeightUpdate + dwPeriod > block.timestamp) {
          return;
        }
        uint256 marketCap = getTokenMarketCap(tokens[i]);
        uint256 changePercent = marketCap.mul(1 ether).div(weightConfig[address(pool)][tokens[i]].mCap);

        (, , , uint256 dynamicTargetWeight) = pool.getDynamicWeightSettings(tokens[i]);
        pool.setDynamicWeight(
          tokens[i],
          dynamicTargetWeight.mul(changePercent).div(1 ether),
          block.timestamp + 1,
          block.timestamp + 1 + dwPeriod
        );

        weightConfig[address(pool)][tokens[i]] = WeightConfig(marketCap, block.timestamp);
      }
    }
  }

  function getTokenMarketCap(address _token) public returns (uint256) {
    uint256 totalSupply = IERC20(_token).totalSupply();
    uint256 len = excludeTokenBalances[_token].length;
    for(uint256 i = 0; i < len; i++) {
      totalSupply = totalSupply.sub(IERC20(_token).balanceOf(excludeTokenBalances[_token][i]));
    }
    return totalSupply.mul(oracle.assetPrices(_token)).div(1 ether);
  }
}
