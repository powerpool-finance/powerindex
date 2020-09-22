pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IPoolRestrictions.sol";


contract PoolRestrictions is IPoolRestrictions, Ownable {

  event SetTotalRestrictions(address indexed token, uint256 maxTotalSupply);

  struct TotalRestrictions {
    uint256 maxTotalSupply;
  }
  // token => restrictions
  mapping(address => TotalRestrictions) public totalRestrictions;

  constructor() public Ownable() {}

  function setTotalRestrictions(address[] calldata _poolsList, uint256[] calldata _maxTotalSupplyList) external onlyOwner {
    _setTotalRestrictions(_poolsList, _maxTotalSupplyList);
  }

  function getMaxTotalSupply(address _poolAddress) external override view returns(uint256) {
    return totalRestrictions[_poolAddress].maxTotalSupply;
  }

  /*** Internal Functions ***/

  function _setTotalRestrictions(address[] memory _poolsList, uint256[] memory _maxTotalSupplyList) internal {
    uint256 len = _poolsList.length;
    require(len == _maxTotalSupplyList.length , "Arrays lengths are not equals");

    for(uint256 i = 0; i < len; i++) {
      totalRestrictions[_poolsList[i]] = TotalRestrictions(_maxTotalSupplyList[i]);
      emit SetTotalRestrictions(_poolsList[i], _maxTotalSupplyList[i]);
    }
  }
}
