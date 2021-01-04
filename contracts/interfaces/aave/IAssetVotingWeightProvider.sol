pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAssetVotingWeightProvider {
  function getVotingWeight(IERC20 _asset) external view returns(uint256);
  function setVotingWeight(IERC20 _asset, uint256 _weight) external;
}
