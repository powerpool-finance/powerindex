function buildBasicRouterConfig(poolRestrictions, voting, staking, reserveRatio, rebalancingInterval, pvp, pvpFee, rewardPools) {
  return { poolRestrictions, voting, staking, reserveRatio, rebalancingInterval, pvp, pvpFee, rewardPools };
}

// AAVE

function buildAaveRouterConfig(AAVE) {
  return { AAVE };
}

function buildAaveAssetConfigInput(emissionPerSecond, totalStaked, underlyingAsset) {
  return { emissionPerSecond, totalStaked, underlyingAsset };
}

// YEARN
function buildYearnRouterConfig(
  YCRV,
  USDC,
  YFI,
  uniswapRouter,
  curveYDeposit,
  usdcYfiSwapPath,
) {
  return { YCRV, USDC, YFI, uniswapRouter, curveYDeposit, usdcYfiSwapPath };
}

module.exports = {
  buildYearnRouterConfig,
  buildBasicRouterConfig,
  buildAaveRouterConfig,
  buildAaveAssetConfigInput
};
