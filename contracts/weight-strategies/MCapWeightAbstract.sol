// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./WeightValueAbstract.sol";

abstract contract MCapWeightAbstract is WeightValueAbstract {
  event SetExcludeTokenBalances(address indexed token, address[] excludeTokenBalances);

  mapping(address => address[]) public excludeTokenBalances;

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

  function getTokenMCap(PowerIndexPoolInterface _pool, address _token) public view returns (uint256) {
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
}
