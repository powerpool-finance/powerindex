// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexBasicRouterInterface {
  function setVotingAndStaking(
    address _voting,
    address _staking
  ) external;
}
