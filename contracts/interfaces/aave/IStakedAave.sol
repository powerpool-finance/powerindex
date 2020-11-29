// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

interface IStakedAave {
  function UNSTAKE_WINDOW() external view returns (uint256);

  function COOLDOWN_SECONDS() external view returns (uint256);

  function stakersCooldowns(address staker) external view returns (uint256);

  function stake(address to, uint256 amount) external;

  function redeem(address to, uint256 amount) external;

  function cooldown() external;

  function claimRewards(address to, uint256 amount) external;
}
