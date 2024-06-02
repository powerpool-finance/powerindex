// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

interface IAutoFarm {
  function poolInfo(uint256 _pid)
    external
    view
    returns (
      address want,
      uint256 allocPoint,
      uint256 lastRewardBlock,
      uint256 accAUTOPerShare,
      address strat
    );

  function userInfo(uint256 _pid, address _user) external view returns (uint256 shares);

  function deposit(uint256 _pid, uint256 _wantAmt) external returns (uint256);

  function withdraw(uint256 _pid, uint256 _wantAmt) external returns (uint256);

  function stakedWantTokens(uint256 _pid, address _user) external view returns (uint256);
}
