// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface WrappedPiErc20Interface is IERC20 {
  function deposit(uint256 _amount) external payable returns (uint256);

  function withdraw(uint256 _amount) external payable returns (uint256);

  function changeRouter(address _newRouter) external;

  function setNoFee(address _for, bool _noFee) external;

  function setEthFee(uint256 _newEthFee) external;

  function withdrawEthFee(address payable receiver) external;

  function approveUnderlying(address _to, uint256 _amount) external;

  function getPiEquivalentForUnderlying(uint256 _underlyingAmount) external view returns (uint256);

  function getUnderlyingEquivalentForPi(uint256 _piAmount) external view returns (uint256);

  function balanceOfUnderlying(address account) external view returns (uint256);

  function callExternal(
    address voting,
    bytes4 signature,
    bytes calldata args,
    uint256 value
  ) external returns (bytes memory);

  struct ExternalCallData {
    address destination;
    bytes4 signature;
    bytes args;
    uint256 value;
  }

  function callExternalMultiple(ExternalCallData[] calldata calls) external returns (bytes[] memory);

  function getUnderlyingBalance() external view returns (uint256);
}
