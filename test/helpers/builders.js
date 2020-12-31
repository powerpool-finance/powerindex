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

function buildYearnRouterArgs(web3, basicConfig, yearnConfig) {
  return web3.eth.abi.encodeParameters(
      [
        {
          BasicConfig: {
            poolRestrictions: 'address',
            voting: 'address',
            staking: 'address',
            reserveRatio: 'uint256',
            rebalancingInterval: 'uint256',
          },
        },
        {
          YearnConfig: {
            YCRV: 'address',
            USDC: 'address',
            YFI: 'address',
            uniswapRouter: 'address',
            curveYDeposit: 'address',
            pvp: 'address',
            pvpFee: 'uint256',
            rewardPools: 'address[]',
            usdcYfiSwapPath: 'address[]',
          },
        },
      ],
      [basicConfig, yearnConfig],
  );
}

module.exports = {
  buildYearnRouterConfig,
  buildBasicRouterConfig,
  buildBasicRouterArgs,
  buildYearnRouterArgs,
};
