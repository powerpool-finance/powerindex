// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./WrappedPiErc20Interface.sol";

interface WrappedPiErc20FactoryInterface {
  event NewWrappedPiErc20(address indexed token, address indexed wrappedToken, address indexed creator);

  function build(
    address _token,
    address _router,
    string calldata _name,
    string calldata _symbol
  ) external returns (WrappedPiErc20Interface);
}
