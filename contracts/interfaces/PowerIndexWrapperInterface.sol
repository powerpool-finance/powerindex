// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexWrapperInterface {
  function setTokenWrapperList(address[] calldata _tokens, address[] calldata _wrappers) external;

  function setTokenWrapper(address _token, address _wrapper) external;
}
