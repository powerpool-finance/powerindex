const { expectEvent, constants } = require('@openzeppelin/test-helpers');
const { ether, artifactFromBytecode } = require('../helpers/index');
const { buildBasicRouterConfig, buildYearnRouterConfig } = require('../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');

const PowerIndexBasicRouter = artifacts.require('PowerIndexBasicRouter');
const YearnPowerIndexRouter = artifacts.require('YearnPowerIndexRouter');
const AavePowerIndexRouter = artifacts.require('AavePowerIndexRouter');
const BasicPowerIndexRouterFactory = artifacts.require('BasicPowerIndexRouterFactory');
const AavePowerIndexRouterFactory = artifacts.require('AavePowerIndexRouterFactory');
const YearnPowerIndexRouterFactory = artifacts.require('YearnPowerIndexRouterFactory');

const StakedAaveV2 = artifactFromBytecode('aave/StakedAaveV2');

MockERC20.numberFormat = 'String';
PowerIndexBasicRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';

const { web3 } = MockERC20;

describe('PowerIndex Implementation Factories Test', () => {
  let deployer,
    bob,
    alice,
    charlie,
    stub,
    token,
    voting,
    poolRestrictions,
    ycrv,
    usdc,
    yfi,
    uniswapRouter,
    curveYDeposit,
    pvp;
  let defaultBasicConfig;
  let defaultFactoryArguments;
  let stakedAave;

  before(async function() {
    [
      deployer,
      bob,
      alice,
      charlie,
      stub,
      token,
      voting,
      poolRestrictions,
      ycrv,
      usdc,
      yfi,
      uniswapRouter,
      curveYDeposit,
      pvp,
    ] = await web3.eth.getAccounts();
    // The staking is AAVE's one, but it's OK that others use it in these test cass.
    stakedAave = await StakedAaveV2.new(
      // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
      alice,
      alice,
      // cooldownSeconds
      864000,
      // unstakeWindow
      172800,
      alice,
      alice,
      // distributionDuration
      12960000,
      'Staked Aave',
      'stkAAVE',
      18,
      // governance
      constants.ZERO_ADDRESS,
    );
    defaultBasicConfig = buildBasicRouterConfig(
      poolRestrictions,
      voting,
      stakedAave.address,
      ether('0.3'),
      4,
      pvp,
      ether('0.15'),
      [alice, bob],
    );
    defaultFactoryArguments = web3.eth.abi.encodeParameter(
      {
        BasicConfig: {
          poolRestrictions: 'address',
          voting: 'address',
          staking: 'address',
          reserveRatio: 'uint256',
          rebalancingInterval: 'uint256',
          pvp: 'address',
          pvpFee: 'uint256',
          rewardPools: 'address[]',
        },
      },
      defaultBasicConfig,
    );
  });

  it('should build basic router correctly', async () => {
    let factory = await BasicPowerIndexRouterFactory.new();

    const res = await factory.buildRouter(token, defaultFactoryArguments);
    const router = await PowerIndexBasicRouter.at(res.logs[0].args.router);

    expectEvent(res, 'BuildBasicRouter', {
      builder: deployer,
      piToken: token,
    });

    assert.equal(await router.owner(), deployer);
    assert.equal(await router.reserveRatio(), ether('0.3'));
    assert.equal(await router.rebalancingInterval(), 4);
    assert.equal(await router.staking(), stakedAave.address);
    assert.equal(await router.poolRestrictions(), poolRestrictions);
    assert.equal(await router.pvp(), pvp);
    assert.equal(await router.pvpFee(), ether('0.15'));
    assert.sameMembers(await router.getRewardPools(), [alice, bob]);
  });

  it('should build yearn router correctly', async () => {
    let factory = await YearnPowerIndexRouterFactory.new();

    const yearnConfig = buildYearnRouterConfig(
      ycrv,
      usdc,
      yfi,
      uniswapRouter,
      curveYDeposit,
      [charlie, stub],
    );
    const yearnFactoryArguments = web3.eth.abi.encodeParameters(
      [
        {
          BasicConfig: {
            poolRestrictions: 'address',
            voting: 'address',
            staking: 'address',
            reserveRatio: 'uint256',
            rebalancingInterval: 'uint256',
            pvp: 'address',
            pvpFee: 'uint256',
            rewardPools: 'address[]',
          },
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
      [defaultBasicConfig, yearnConfig],
    );

    const res = await factory.buildRouter(token, yearnFactoryArguments);
    const router = await YearnPowerIndexRouter.at(res.logs[0].args.router);

    expectEvent(res, 'BuildYearnRouter', {
      builder: deployer,
      piToken: token,
    });

    assert.equal(await router.owner(), deployer);
    assert.equal(await router.reserveRatio(), ether('0.3'));
    assert.equal(await router.rebalancingInterval(), 4);
    assert.equal(await router.staking(), stakedAave.address);
    assert.equal(await router.poolRestrictions(), poolRestrictions);
    assert.equal(await router.pvp(), pvp);
    assert.equal(await router.pvpFee(), ether('0.15'));
    assert.sameMembers(await router.getRewardPools(), [alice, bob]);

    assert.equal(await router.YCRV(), ycrv);
    assert.equal(await router.USDC(), usdc);
    assert.equal(await router.YFI(), yfi);
    assert.equal(await router.uniswapRouter(), uniswapRouter);
    assert.equal(await router.curveYDeposit(), curveYDeposit);
    assert.sameMembers(await router.getUsdcYfiSwapPath(), [charlie, stub]);
  });

  it('should build aave router correctly', async () => {
    let factory = await AavePowerIndexRouterFactory.new();

    const res = await factory.buildRouter(token, defaultFactoryArguments);
    const router = await AavePowerIndexRouter.at(res.logs[0].args.router);

    expectEvent(res, 'BuildAaveRouter', {
      builder: deployer,
      piToken: token,
    });

    assert.equal(await router.owner(), deployer);
    assert.equal(await router.reserveRatio(), ether('0.3'));
    assert.equal(await router.rebalancingInterval(), 4);
    assert.equal(await router.staking(), stakedAave.address);
    assert.equal(await router.poolRestrictions(), poolRestrictions);
    assert.equal(await router.pvp(), pvp);
    assert.equal(await router.pvpFee(), ether('0.15'));
    assert.sameMembers(await router.getRewardPools(), [alice, bob]);
  });
});
