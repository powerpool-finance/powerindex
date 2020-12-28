function buildBasicRouterConfig(poolRestrictions, voting, staking, reserveRatio, rebalancingInterval) {
  return { poolRestrictions, voting, staking, reserveRatio, rebalancingInterval }
}

function buildYearnRouterConfig(YCRV, USDC, YFI, uniswapRouter, curveYDeposit, pvp, pvpFee, rewardPools, usdcYfiSwapPath) {
  return { YCRV, USDC, YFI, uniswapRouter, curveYDeposit, pvp, pvpFee, rewardPools, usdcYfiSwapPath }
}

module.exports = {
  buildYearnRouterConfig,
  buildBasicRouterConfig
}
