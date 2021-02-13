// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./MCapWeightAbstract.sol";
import "../PowerIndexPoolController.sol";
import "hardhat/console.sol";

contract MCapWeightStrategyRebinder is MCapWeightAbstract {

  constructor(address _oracle) public MCapWeightAbstract(_oracle) { }

  function runRebind(
    PowerIndexPoolInterface _pool,
    address _newController,
    uint256 _oldWeightDiv
  ) public onlyOwner {
    address[] memory tokens = _pool.getCurrentTokens();
    uint256 len = tokens.length;

    uint256[] memory oldBalances = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      oldBalances[i] = _pool.getBalance(tokens[i]);
    }

    uint256 now = block.timestamp;
    (uint256[3][] memory weightsChange, ) = computeWeightsChange(_pool, tokens, 0, 100 ether, now, now + 1);

    uint256[] memory newBalances = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      uint256[3] memory wc = weightsChange[i];
      uint256 ti = wc[0];
      uint256 oldWeight = wc[1] / _oldWeightDiv;
      uint256 newWeight = wc[2];
      newBalances[ti] = bmul(oldBalances[ti], bdiv(newWeight, oldWeight));

      IERC20(tokens[ti]).approve(address(_pool), newBalances[ti]);
      _pool.rebind(tokens[ti], newBalances[ti], newWeight);
    }

    setController(_pool, _newController);
  }

  function setController(PowerIndexPoolInterface _pool, address _newController) public onlyOwner {
    _pool.setController(_newController);
  }
}

interface IERC20Symbol {
  function symbol() external view returns (string calldata);
}
