pragma solidity 0.6.12;

interface InstantUniswapPrice {
  function contractUsdTokensSum(address _contract, address[] memory _tokens) external view returns (uint256);

  function balancerPoolUsdTokensSum(address _balancerPool) external view returns (uint256);

  function usdcTokensSum(address[] memory _tokens, uint256[] memory _balances) external view returns (uint256);
}
