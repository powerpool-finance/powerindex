function buildBasicRouterConfig(poolRestrictions, powerPoke, voting, staking, reserveRatio, reserveRatioToForceRebalance, claimRewardsInterval, pvp, pvpFee, rewardPools) {
  return {
    poolRestrictions,
    powerPoke,
    voting,
    staking,
    reserveRatio,
    reserveRatioToForceRebalance,
    claimRewardsInterval,
    pvp,
    pvpFee,
    rewardPools,
  };
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

// SUSHI
function buildSushiRouterConfig(SUSHI) {
  return { SUSHI };
}

// PANCAKE MASTER CHEF
function buildPancakeMasterChefRouterConfig(cake) {
  return { cake };
}


const BasicConfig = {
  poolRestrictions: 'address',
  powerPoke: 'address',
  voting: 'address',
  staking: 'address',
  reserveRatio: 'uint256',
  reserveRatioToForceRebalance: 'uint256',
  claimRewardsInterval: 'uint256',
  pvp: 'address',
  pvpFee: 'uint256',
  rewardPools: 'address[]',
};

function buildBasicRouterArgs(web3, config) {
  return web3.eth.abi.encodeParameter(
    {
      BasicConfig,
    },
    config,
  );
}

function buildAaveRouterArgs(web3, basicConfig, aaveConfig) {
  return web3.eth.abi.encodeParameters(
    [
      {
        BasicConfig,
      },
      {
        AaveConfig: {
          AAVE: 'address',
        },
      },
    ],
    [basicConfig, aaveConfig],
  );
}

function buildSushiRouterArgs(web3, basicConfig, sushiConfig) {
  return web3.eth.abi.encodeParameters(
    [
      {
        BasicConfig,
      },
      {
        SushiConfig: {
          SUSHI: 'address',
        },
      },
    ],
    [basicConfig, sushiConfig],
  );
}

function buildYearnRouterArgs(web3, basicConfig, yearnConfig) {
  return web3.eth.abi.encodeParameters(
    [
      {
        BasicConfig,
      },
      {
        YearnConfig: {
          YCRV: 'address',
          USDC: 'address',
          YFI: 'address',
          uniswapRouter: 'address',
          curveYDeposit: 'address',
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
  buildSushiRouterConfig,
  buildPancakeMasterChefRouterConfig,
  buildAaveAssetConfigInput,
  buildBasicRouterArgs,
  buildYearnRouterArgs,
  buildAaveRouterArgs,
  buildSushiRouterArgs,
};
