// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/PiRouterInterface.sol";

contract PowerIndexSimpleRouter is PiRouterInterface, Ownable {
  constructor() public {}

  function migrateWrappedTokensToNewRouter(address[] calldata _wrappedTokens, address _newRouter)
    external
    override
    onlyOwner
  {
    uint256 len = _wrappedTokens.length;
    for (uint256 i = 0; i < len; i++) {
      WrappedPiErc20Interface(_wrappedTokens[i]).changeRouter(_newRouter);
    }
  }

  function wrapperCallback(uint256 _withdrawAmount) external virtual override {
    // DO NOTHING
  }
}
