const { constants, time, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const {
  ether,
  artifactFromBytecode,
  deployProxied,
  createOrGetProxyAdmin,
  splitPayload,
  advanceBlocks,
  increaseTimeTo,
  getResTimestamp,
  evmSetNextBlockTimestamp,
} = require('../../helpers');
const { buildBasicRouterConfig, buildAaveRouterConfig, buildAaveAssetConfigInput } = require('../../helpers/builders');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const AavePowerIndexRouter = artifacts.require('AavePowerIndexRouter');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const PoolRestrictions = artifacts.require('PoolRestrictions');
const MyContract = artifacts.require('MyContract');
const MockGulpingBPool = artifacts.require('MockGulpingBPool');
const { web3 } = MockERC20;
const { BN } = web3.utils;

const AaveToken = artifactFromBytecode('aave/AaveToken');
const AaveTokenV2 = artifactFromBytecode('aave/AaveTokenV2');
const StakedAaveV2 = artifactFromBytecode('aave/StakedAaveV2');
const AaveGovernanceV2 = artifactFromBytecode('aave/AaveGovernanceV2');
const AaveGovernanceStrategy = artifactFromBytecode('aave/AaveGovernanceStrategy');
const AaveExecutor = artifactFromBytecode('aave/AaveExecutor');

MockERC20.numberFormat = 'String';
AavePowerIndexRouter.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
StakedAaveV2.numberFormat = 'String';

// in blocks
const VOTE_DURATION = 5;

// 3 000 000
// const AAVE_DISTRIBUTION_AMOUNT = ether(3000000);
// const AAVE_MIGRATOR_AMOUNT = ether(13000000);
// const AAVE_TOTAL_AMOUNT = ether(16000000);

const ProposalState = {
  Pending: 0,
  Canceled: 1,
  Active: 2,
  Failed: 3,
  Succeeded: 4,
  Queued: 5,
  Expired: 6,
  Executed: 7,
};

const COOLDOWN_STATUS = {
  NONE: 0,
  COOLDOWN: 1,
  UNSTAKE_WINDOW: 2,
};

describe('AaveRouter Tests', () => {
  let deployer,
    aaveDistributor,
    bob,
    alice,
    rewardsVault,
    emissionManager,
    stub,
    guardian,
    piGov,
    pvp;

  before(async function() {
    [
      deployer,
      aaveDistributor,
      bob,
      alice,
      rewardsVault,
      emissionManager,
      stub,
      guardian,
      piGov,
      pvp
    ] = await web3.eth.getAccounts();
  });

  let aave, stakedAave, piAave, aaveRouter, poolRestrictions;

  // https://github.com/aave/aave-stake-v2
  describe('staking', async () => {
    beforeEach(async () => {
      // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
      aave = await deployProxied(
        AaveToken,
        [
          // migrator
          aaveDistributor,
          // distributor
          aaveDistributor,
          // governance
          constants.ZERO_ADDRESS,
        ],
        { deployer, proxyAdminOwner: deployer, initializer: 'initialize' },
      );
      const proxyAdmin = await createOrGetProxyAdmin();
      const aave2 = await AaveTokenV2.new();
      await proxyAdmin.upgrade(aave.address, aave2.address);

      // Setting up Aave Governance and Staking
      // 0x4da27a545c0c5B758a6BA100e3a049001de870f5
      stakedAave = await StakedAaveV2.new(
        // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
        aave.address,
        // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
        aave.address,
        // cooldownSeconds
        864000,
        // unstakeWindow
        172800,
        rewardsVault,
        emissionManager,
        // distributionDuration
        12960000,
        'Staked Aave',
        'stkAAVE',
        18,
        // governance
        constants.ZERO_ADDRESS,
      );

      poolRestrictions = await PoolRestrictions.new();
      piAave = await WrappedPiErc20.new(aave.address, stub, 'wrapped.aave', 'piAAVE');
      aaveRouter = await AavePowerIndexRouter.new(
        piAave.address,
        buildBasicRouterConfig(
          poolRestrictions.address,
          constants.ZERO_ADDRESS,
          stakedAave.address,
          ether('0.2'),
          '0',
          pvp,
          ether('0.2'),
          [],
        ),
        buildAaveRouterConfig(aave.address),
      );

      // Setting up...
      await piAave.changeRouter(aaveRouter.address, { from: stub });
      await aave.transfer(stakedAave.address, ether(42000), { from: aaveDistributor });
      await aaveRouter.transferOwnership(piGov);

      // Checks...
      assert.equal(await aaveRouter.owner(), piGov);
    });

    it('should deny non-piToken calling piTokenCallback', async () => {
      await expectRevert(aaveRouter.piTokenCallback(0), 'ONLY_PI_TOKEN_ALLOWED');
    });

    it('should allow depositing Aave and staking it in a StakedAave contract', async () => {});

    describe('stake', async () => {
      beforeEach(async () => {
        await aave.transfer(alice, ether('10000'), { from: aaveDistributor });
        await aave.transfer(bob, ether('10000'), { from: aaveDistributor });
      });

      it('it should initially stake the excess of funds to the staking contract immediately', async () => {
        await aave.approve(piAave.address, ether(10000), { from: alice });
        await piAave.deposit(ether('10000'), { from: alice });

        assert.equal(await piAave.totalSupply(), ether(10000));
        assert.equal(await piAave.balanceOf(alice), ether(10000));

        // The router has partially staked the deposit with regard to the reserve ration value (20/80)
        assert.equal(await aave.balanceOf(piAave.address), ether(2000));
        assert.equal(await stakedAave.balanceOf(piAave.address), ether(8000));
        assert.equal(await aave.balanceOf(stakedAave.address), ether(50000));

        // The stakeAave are allocated on the aaveWrapper contract
        assert.equal(await stakedAave.balanceOf(piAave.address), ether(8000));
      });

      describe('with some funds already deposited', async () => {
        beforeEach(async () => {
          await aave.approve(piAave.address, ether(10000), { from: alice });
          await piAave.deposit(ether(10000), { from: alice });
        });

        it('it should stake the excess of funds to the staking contract immediately', async () => {
          // 2nd
          await aave.approve(piAave.address, ether(10000), { from: bob });
          await piAave.deposit(ether(10000), { from: bob });

          assert.equal(await piAave.totalSupply(), ether(20000));
          assert.equal(await piAave.balanceOf(alice), ether(10000));
          assert.equal(await piAave.balanceOf(bob), ether(10000));

          // The router has partially staked the deposit with regard to the reserve ration value (20/80)
          assert.equal(await aave.balanceOf(piAave.address), ether(4000));
          assert.equal(await aave.balanceOf(stakedAave.address), ether(58000));
          assert.equal(await stakedAave.balanceOf(piAave.address), ether(16000));

          // The stakeAave are allocated on the aaveWrapper contract
          assert.equal(await stakedAave.balanceOf(piAave.address), ether(16000));
        });

        it('it should stake the excess of funds while in the COOLDOWN period', async () => {
          await piAave.approve(piAave.address, ether(500), { from: alice });
          await piAave.withdraw(ether(500), { from: alice });
          await piAave.approve(piAave.address, ether(500), { from: alice });
          await piAave.withdraw(ether(500), { from: alice });
          await piAave.approve(piAave.address, ether(500), { from: alice });
          await piAave.withdraw(ether(500), { from: alice });
          await piAave.approve(piAave.address, ether(500), { from: alice });
          await piAave.withdraw(ether(500), { from: alice });

          assert.equal((await aaveRouter.getCoolDownStatus()).status, COOLDOWN_STATUS.COOLDOWN);

          await aave.approve(piAave.address, ether(10000), { from: bob });
          await piAave.deposit(ether(10000), { from: bob });
        });
      });
    });

    describe('do nothing', async () => {
      it('it should do nothing if the stake hasn\'t changed', async () => {
        await aave.transfer(alice, ether('10000'), { from: aaveDistributor });
        await aave.approve(piAave.address, ether(1000), { from: alice });
        await piAave.deposit(ether(1000), { from: alice });
        await aave.transfer(piAave.address, ether(50), { from: alice });
        assert.equal(await aave.balanceOf(piAave.address), ether(250));
        assert.equal(await aave.balanceOf(stakedAave.address), ether(42800));

        // 2nd
        await piAave.approve(piAave.address, ether(50), { from: alice });
        await piAave.withdraw(ether(50), { from: alice });

        // The router has partially staked the deposit with regard to the reserve ration value (20/80)
        assert.equal(await aave.balanceOf(piAave.address), ether(200));
        assert.equal(await aave.balanceOf(stakedAave.address), ether(42800));
      });
    });

    describe('rewards distribution', async () => {
      let poolA, poolB, poolC, poolD;
      let last;

      beforeEach(async () => {
        poolA = await MockGulpingBPool.new();
        poolB = await MockGulpingBPool.new();
        poolC = await MockGulpingBPool.new();
        poolD = await MockGulpingBPool.new();

        await aaveRouter.setRewardPools([poolA.address, poolB.address, poolC.address], { from: piGov})

        await aave.transfer(alice, ether('11000'), { from: aaveDistributor });
        let res = await aave.transfer(alice, ether('100000'), { from: aaveDistributor });
        last = await getResTimestamp(res);

        await stakedAave.configureAssets(
          [buildAaveAssetConfigInput(ether(1), `${last}000000000000`, stakedAave.address)],
          { from: emissionManager },
        );

        await aave.approve(piAave.address, ether(10000), { from: alice });
        await piAave.deposit(ether('10000'), { from: alice });

        await piAave.transfer(poolA.address, 10, { from: alice });
        await piAave.transfer(poolB.address, 20, { from: alice });

        await aave.approve(stakedAave.address, ether(10000000), { from: rewardsVault });
        await aave.transfer(rewardsVault, ether(10000000), { from: aaveDistributor });

        assert.equal(await stakedAave.totalSupply(), ether(8000));
      });

      it('should allow claiming rewards', async () => {
        const increaseTo = new BN(last).add(new BN(100));
        try {
          // hardhat network could explicitly set the next block timestamp
          await evmSetNextBlockTimestamp(increaseTo.toNumber());
        } catch (e) {
          // while ganache (when running coverage) sets it roughly
          await increaseTimeTo(increaseTo);
        }

        const claimRes = await aaveRouter.claimRewards({ from: bob });
        const distributeRes = await aaveRouter.distributeRewards({ from: bob });

        // The following assertions will fail when running coverage
        expectEvent(claimRes, 'ClaimRewards', {
          sender: bob,
          aaveReward: '97000000000000000000'
        });
        await expectEvent.inTransaction(claimRes.tx, stakedAave, 'RewardsClaimed', {
          from: piAave.address,
          to: aaveRouter.address,
          amount: '97000000000000000000'
        });

        expectEvent(distributeRes, 'DistributeRewards', {
          sender: bob,
          aaveReward: '97000000000000000000',
          pvpReward: '19400000000000000000',
          poolRewardsUnderlying: '77600000000000000000',
          poolRewardsPi: '77600000000000000000',
          pools: [poolA.address, poolB.address, poolC.address],
        });

        await expectEvent.inTransaction(distributeRes.tx, poolA, 'Gulp');
        await expectEvent.inTransaction(distributeRes.tx, poolB, 'Gulp');
        await expectEvent.notEmitted.inTransaction(distributeRes.tx, poolC, 'Gulp');
        await expectEvent.notEmitted.inTransaction(distributeRes.tx, poolD, 'Gulp');

        assert.equal(distributeRes.logs.length, 4);
        assert.equal(distributeRes.logs[1].args.pool, poolA.address);
        assert.equal(distributeRes.logs[1].args.amount, '25866666666666666666');
        assert.equal(distributeRes.logs[2].args.pool, poolB.address);
        assert.equal(distributeRes.logs[2].args.amount, '51733333333333333333');

        assert.equal(await piAave.balanceOf(poolA.address), 25866666666666666666 + 10);
        assert.equal(await piAave.balanceOf(poolB.address), 51733333333333333333 + 20);
        assert.equal(await piAave.balanceOf(poolC.address), '0');
        assert.equal(await piAave.balanceOf(poolD.address), '0');

        assert.equal(await aave.balanceOf(aaveRouter.address), '0');
        assert.equal(await piAave.balanceOf(aaveRouter.address), '1');
      });

      it('should revert claimRewards() if there is no reward available', async () => {
        await stakedAave.configureAssets(
          [buildAaveAssetConfigInput(0, '0', stakedAave.address)],
          { from: emissionManager },
        );
        await expectRevert(aaveRouter.claimRewards({ from: alice }), 'NOTING_TO_CLAIM');
      });

      it('should revert distribute rewards() if there is no yCrv on the balance', async () => {
        await expectRevert(aaveRouter.distributeRewards({ from: bob }), 'NO_PENDING_REWARD');
      });

      it('should revert distributing rewards when missing reward pools config', async () => {
        const router = await AavePowerIndexRouter.new(
          piAave.address,
          buildBasicRouterConfig(
            poolRestrictions.address,
            constants.ZERO_ADDRESS,
            stakedAave.address,
            ether('0.2'),
            '0',
            pvp,
            ether('0.2'),
            [],
          ),
          buildAaveRouterConfig(
            aave.address
          ),
        );
        await aaveRouter.migrateToNewRouter(piAave.address, router.address, { from: piGov });
        await time.increase(1);
        await router.claimRewards({ from: bob });
        await expectRevert(router.distributeRewards({ from: bob }), 'MISSING_REWARD_POOLS');
      });
    });

    // https://github.com/aave/governance-v2
    describe('voting', async () => {
      // let votingStrategy, aavePropositionPower, weightProvider, paramsProvider, aaveGovernance;
      let executor, aaveGovernanceStrategy, aaveGovernanceV2;

      beforeEach(async () => {
        // 0xb7e383ef9b1e9189fc0f71fb30af8aa14377429e
        aaveGovernanceStrategy = await AaveGovernanceStrategy.new(
          // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
          aave.address,
          // 0x4da27a545c0c5b758a6ba100e3a049001de870f5
          stakedAave.address,
        );

        // 0xec568fffba86c094cf06b22134b23074dfe2252c
        aaveGovernanceV2 = await AaveGovernanceV2.new(
          aaveGovernanceStrategy.address,
          // votingDelay
          0,
          guardian,
          // executors
          [],
        );

        // long - 0x61910ecd7e8e942136ce7fe7943f956cea1cc2f7, short - 0xee56e2b3d491590b5b31738cc34d5232f378a8d5
        executor = await AaveExecutor.new(
          aaveGovernanceV2.address,
          // delay
          604800,
          // gracePeriod
          432000,
          // minimumDelay
          604800,
          // maximumDelay
          864000,
          // propositionThreshold
          50,
          // voteDuration (in blocks)
          VOTE_DURATION,
          // voteDifferential
          1500,
          // minimumQuorum
          2000,
        );

        await aaveGovernanceV2.authorizeExecutors([executor.address]);
        await aaveRouter.setVotingAndStaking(aaveGovernanceV2.address, stakedAave.address, { from: piGov });
      });

      it('should allow depositing Aave and staking it in a StakedAave contract', async () => {
        // The idea of the test to set a non-zero answer for the MyContract instance
        const myContract = await MyContract.new();
        await myContract.transferOwnership(executor.address);

        await aave.transfer(alice, ether('10000'), { from: aaveDistributor });
        await aave.approve(piAave.address, ether('10000'), { from: alice });
        await piAave.deposit(ether('10000'), { from: alice });

        assert.equal(await piAave.totalSupply(), ether('10000'));
        assert.equal(await piAave.balanceOf(alice), ether('10000'));

        // The router has partially staked the deposit with regard to the reserve ration value (20/80)
        assert.equal(await aave.balanceOf(piAave.address), ether(2000));
        assert.equal(await aave.balanceOf(stakedAave.address), ether(50000));

        // The stakeAave are allocated on the aaveWrapper contract
        assert.equal(await stakedAave.balanceOf(piAave.address), ether(8000));

        /// Stake....
        await aave.transfer(alice, ether(12300000), { from: aaveDistributor });
        await aave.approve(piAave.address, ether(12300000), { from: alice });
        await piAave.deposit(ether(12300000), { from: alice });
        assert.equal(await stakedAave.balanceOf(piAave.address), ether(9848000));
        assert.equal(await aave.balanceOf(piAave.address), ether(2462000));

        await poolRestrictions.setVotingAllowedForSenders(aaveGovernanceV2.address, [alice], [true]);

        /// Create a proposal...
        const setAnswerData = myContract.contract.methods.setAnswer(42).encodeABI();
        const createProposalData = aaveGovernanceV2.contract.methods
          .create(
            executor.address,
            [myContract.address],
            [0],
            ['setAnswer(uint256)'],
            [splitPayload(setAnswerData).calldata],
            [false],
            '0x0',
          )
          .encodeABI();
        assert.equal(await aaveGovernanceV2.getProposalsCount(), '0');
        let res = await aaveRouter.callCreate(splitPayload(createProposalData).calldata, { from: alice });
        assert.equal(await aaveGovernanceV2.getProposalsCount(), '1');
        await expectEvent.inTransaction(res.tx, AaveGovernanceV2, 'ProposalCreated', {
          id: '0',
          creator: piAave.address,
          values: ['0'],
          targets: [myContract.address],
          signatures: ['setAnswer(uint256)'],
          calldatas: [splitPayload(setAnswerData).calldata],
          withDelegatecalls: [false],
          ipfsHash: constants.ZERO_BYTES32,
        });

        // Vote for the proposal...
        res = await aaveRouter.callSubmitVote(0, true, { from: alice });
        await expectEvent.inTransaction(res.tx, AaveGovernanceV2, 'VoteEmitted', {
          id: '0',
          voter: piAave.address,
          support: true,
          votingPower: ether(12310000),
        });

        await advanceBlocks(VOTE_DURATION);
        await aaveGovernanceV2.queue('0');
        await time.increase(604801);
        await aaveGovernanceV2.execute('0');
        assert.equal(await aaveGovernanceV2.getProposalState('0'), ProposalState.Executed);
      });
    });
  });
});
