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
  buildAaveRouterConfig,
  buildAaveAssetConfigInput,
  buildBasicRouterArgs,
  buildYearnRouterArgs,
};
