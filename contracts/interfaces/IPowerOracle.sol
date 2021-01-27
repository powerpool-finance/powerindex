pragma solidity 0.6.12;

interface IPowerOracle {
  function assetPrices(address _token) external view returns (uint256);
}
