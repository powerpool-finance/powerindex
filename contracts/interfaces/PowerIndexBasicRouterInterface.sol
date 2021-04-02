// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface PowerIndexBasicRouterInterface {
  function setVotingAndStaking(address _voting, address _staking) external;

  function setReserveConfig(uint256 _reserveRatio, uint256 _claimRewardsInterval) external;

  function getPiEquivalentForUnderlying(
    uint256 _underlyingAmount,
    IERC20 _underlyingToken,
    uint256 _piTotalSupply
  ) external view returns (uint256);

  function getPiEquivalentForUnderlyingPure(
    uint256 _underlyingAmount,
    uint256 _totalUnderlyingWrapped,
    uint256 _piTotalSupply
  ) external pure returns (uint256);

  function getUnderlyingEquivalentForPi(
    uint256 _piAmount,
    IERC20 _underlyingToken,
    uint256 _piTotalSupply
  ) external view returns (uint256);

  function getUnderlyingEquivalentForPiPure(
    uint256 _piAmount,
    uint256 _totalUnderlyingWrapped,
    uint256 _piTotalSupply
  ) external pure returns (uint256);
}
