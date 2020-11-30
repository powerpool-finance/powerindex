// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface PowerIndexBasicRouterInterface {
  function setVotingAndStakingForWrappedToken(
    address _wrapper,
    address _voting,
    address _staking
  ) external;
}
