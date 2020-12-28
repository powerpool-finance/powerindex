// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../powerindex-router/PowerIndexBasicRouter.sol";
import "../powerindex-router/WrappedPiErc20.sol";

contract MockLeakingRouter is PowerIndexBasicRouter {
  constructor(address _piToken, BasicConfig memory _basicConfig) public PowerIndexBasicRouter(_piToken, _basicConfig) {}

  function drip(address _to, uint256 _amount) external {
    piToken.callExternal(
      address(WrappedPiErc20(address(piToken)).underlying()),
      IERC20(0).transfer.selector,
      abi.encode(_to, _amount),
      0
    );
  }
}
