// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../powerindex-router/PowerIndexBasicRouter.sol";
import "../powerindex-router/WrappedPiErc20.sol";

contract MockLeakingRouter is PowerIndexBasicRouter {
  constructor(address _piToken, address _poolRestrictions) public PowerIndexBasicRouter(_piToken, _poolRestrictions) {}

  function drip(address _to, uint256 _amount) external {
    wrappedToken.callExternal(
      address(WrappedPiErc20(address(wrappedToken)).underlying()),
      IERC20(0).transfer.selector,
      abi.encode(_to, _amount),
      0
    );
  }
}
