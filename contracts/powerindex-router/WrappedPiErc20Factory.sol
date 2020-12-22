// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./WrappedPiErc20.sol";
import "../interfaces/WrappedPiErc20FactoryInterface.sol";

contract WrappedPiErc20Factory is WrappedPiErc20FactoryInterface {
  constructor() public {}

  function build(
    address _token,
    address _router,
    string calldata _name,
    string calldata _symbol
  ) external override returns (WrappedPiErc20Interface) {
    WrappedPiErc20 wrappedToken = new WrappedPiErc20(_token, _router, _name, _symbol);

    emit NewWrappedPiErc20(address(wrappedToken), msg.sender);

    return wrappedToken;
  }
}
