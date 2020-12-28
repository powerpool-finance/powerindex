function buildBasicRouterConfig(poolRestrictions, voting, staking, reserveRatio, rebalancingInterval) {
  return { poolRestrictions, voting, staking, reserveRatio, rebalancingInterval };
}

function buildYearnRouterConfig(
  YCRV,
  USDC,
  YFI,
  uniswapRouter,
  curveYDeposit,
  pvp,
  pvpFee,
  rewardPools,
  usdcYfiSwapPath,
) {
  return { YCRV, USDC, YFI, uniswapRouter, curveYDeposit, pvp, pvpFee, rewardPools, usdcYfiSwapPath };
}

function buildBasicRouterArgs(web3, config) {
  return web3.eth.abi.encodeParameter(
    {
      BasicConfig: {
        poolRestrictions: 'address',
        voting: 'address',
        staking: 'address',
        reserveRatio: 'uint256',
        rebalancingInterval: 'uint256',
      },
    },
    config,
  );
}

module.exports = {
  buildYearnRouterConfig,
  buildBasicRouterConfig,
  buildBasicRouterArgs,
};
