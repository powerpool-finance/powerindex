// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

interface CurveStakeInterface {
  function deposit_for(address addr, uint256 amount) external;

  function create_lock(uint256 amount, uint256 time) external;

  function increase_amount(uint256 amount) external;

  function increase_unlock_time(uint256 time) external;

  function withdraw() external;

  function balanceOf(address account) external view returns (uint256);

  function locked(address account) external view returns (uint256, uint256);
}
