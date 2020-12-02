const { time, ether: rEther, expectEvent } = require("@openzeppelin/test-helpers");
const { artifactFromBytecode, toEvmBytes32 } = require("./helpers/index");
const assert = require("chai").assert;
const MockERC20 = artifacts.require("MockERC20");
const AavePowerIndexRouter = artifacts.require("AavePowerIndexRouter");
const WrappedPiErc20 = artifacts.require("WrappedPiErc20");
const PoolRestrictions = artifacts.require("PoolRestrictions");
const AIP2ProposalPayload = artifacts.require("AIP2ProposalPayload");
const { web3 } = MockERC20;
const { keccak256, numberToHex } = web3.utils;

const StakedAave = artifactFromBytecode("aave/StakedAave");
const AaveProtoGovernance = artifactFromBytecode("aave/AaveProtoGovernance");
const AssetVotingWeightProvider = artifactFromBytecode("aave/AssetVotingWeightProvider");
const GovernanceParamsProvider = artifactFromBytecode("aave/GovernanceParamsProvider");
const AaveVoteStrategyToken = artifactFromBytecode("aave/AaveVoteStrategyToken");

MockERC20.numberFormat = "String";
AavePowerIndexRouter.numberFormat = "String";
WrappedPiErc20.numberFormat = "String";

function ether(value) {
  return rEther(value.toString()).toString(10);
}

describe.only("AaveRouter Tests", () => {
  let minter, bob, alice, charlie, yearnOwner, rewardsVault, emissionManager, lendToken;

  before(async function() {
    [minter, bob, alice, charlie, yearnOwner, rewardsVault, emissionManager, lendToken, stub] = await web3.eth.getAccounts();
  });

  beforeEach(async function() {
    [minter, bob, alice, charlie, yearnOwner, rewardsVault, emissionManager, lendToken, stub] = await web3.eth.getAccounts();
  });

  let aave, stakedAave, aaveWrapper, router, poolRestrictions;

  describe("staking", async () => {
    beforeEach(async () => {
      // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
      aave = await MockERC20.new("Aave Token", "AAVE", "18", ether("100000000000"));

      // Setting up Aave Governance and Staking
      // 0x4da27a545c0c5B758a6BA100e3a049001de870f5
      stakedAave = await StakedAave.new(
        // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
        aave.address,
        // 0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9
        aave.address,
        864000, 172800, rewardsVault, emissionManager, 12960000
      );
      poolRestrictions = await PoolRestrictions.new();
      router = await AavePowerIndexRouter.new(poolRestrictions.address);

      aaveWrapper = await WrappedPiErc20.new(aave.address, router.address, "wrapped.aave", "WAAVE");

      // Setting up...
      await router.setVotingAndStakingForWrappedToken(aaveWrapper.address, stub, stakedAave.address);
      await router.setReserveRatioForWrappedToken(aaveWrapper.address, ether("0.2"));

      // Checks...
      assert.equal(await router.owner(), minter);
    });

    it("should allow depositing Aave and staking it in a StakedAave contract", async () => {
      await aave.transfer(alice, ether("10000"));
      await aave.approve(aaveWrapper.address, ether("10000"), { from: alice });
      await aaveWrapper.deposit(ether("10000"), { from: alice });

      assert.equal(await aaveWrapper.totalSupply(), ether("10000"));
      assert.equal(await aaveWrapper.balanceOf(alice), ether("10000"));

      // The router has partially staked the deposit with regard to the reserve ration value (20/80)
      assert.equal(await aave.balanceOf(aaveWrapper.address), ether(2000));
      assert.equal(await aave.balanceOf(stakedAave.address), ether(8000));

      // The stakeAave are allocated on the aaveWrapper contract
      assert.equal(await stakedAave.balanceOf(aaveWrapper.address), ether(8000));
    });

    describe("voting", async () => {
      let votingStrategy, aavePropositionPower, weightProvider, paramsProvider, aaveGovernance;

      beforeEach(async () => {
        // 0xa5e83c1a6e56f27f7764e5c5d99a9b8786e3a391
        votingStrategy = await AaveVoteStrategyToken.new(aave.address, stakedAave.address);

        // 0x72bbcfc20d355fc3e8ac4ce8fcaf63874f746631
        aavePropositionPower = await MockERC20.new("Aave Proposition Power", "APP", "18", ether("1000000"));

        // 0x5ac493b8c2cef1f02f117b9ba2797e7da95574aa
        weightProvider = await AssetVotingWeightProvider.new(
          // [0xa5e83c1a6e56f27f7764e5c5d99a9b8786e3a391]
          [votingStrategy.address],
          [100]
        );

        // 0xf7ff0aee0c2d6fbdea3a85742443e284b62fd0b2
        paramsProvider = await GovernanceParamsProvider.new(
          ether(1),
          // 0x72bbcfc20d355fc3e8ac4ce8fcaf63874f746631
          aavePropositionPower.address,
          // 0x5ac493b8c2cef1f02f117b9ba2797e7da95574aa
          weightProvider.address
        );

        // 0x8a2efd9a790199f4c94c6effe210fce0b4724f52
        aaveGovernance = await AaveProtoGovernance.new(
          // 0xf7ff0aee0c2d6fbdea3a85742443e284b62fd0b2
          paramsProvider.address
        );

        await aavePropositionPower.mint(charlie, ether(3));
        await router.setVotingAndStakingForWrappedToken(aaveWrapper.address, aaveGovernance.address, stakedAave.address);
      });

      it("should allow depositing Aave and staking it in a StakedAave contract", async () => {
        await aave.transfer(alice, ether("10000"));
        await aave.approve(aaveWrapper.address, ether("10000"), { from: alice });
        await aaveWrapper.deposit(ether("10000"), { from: alice });

        assert.equal(await aaveWrapper.totalSupply(), ether("10000"));
        assert.equal(await aaveWrapper.balanceOf(alice), ether("10000"));

        // The router has partially staked the deposit with regard to the reserve ration value (20/80)
        assert.equal(await aave.balanceOf(aaveWrapper.address), ether(2000));
        assert.equal(await aave.balanceOf(stakedAave.address), ether(8000));

        // The stakeAave are allocated on the aaveWrapper contract
        assert.equal(await stakedAave.balanceOf(aaveWrapper.address), ether(8000));

        /// Voting....
        await aave.transfer(alice, ether(23000000));
        await aave.approve(aaveWrapper.address, ether(23000000), { from: alice });
        await aaveWrapper.deposit(ether(23000000), { from: alice });
        assert.equal(await stakedAave.balanceOf(aaveWrapper.address), ether(18408000));

        let executor = await AIP2ProposalPayload.new();

        await poolRestrictions.setVotingAllowedForSenders(aaveGovernance.address, [alice], [true]);

        await aaveGovernance.newProposal(
          // proposalType
          numberToHex("1"),
          // ipfsHash
          "0x0",
          // threshold
          ether(13000000),
          // proposalExecutor
          executor.address,
          // votingBlocksDuration
          5,
          // validatingBlocksDuration
          5,
          // _maxMovesToVotingAllowed
          4,
          { from: charlie }
        );
        await router.executeSubmitVote(aaveWrapper.address, 0, 1, votingStrategy.address, { from: alice });

        await time.advanceBlockTo((await time.latestBlock()).toNumber() + 5);
        await aaveGovernance.tryToMoveToValidating(0);
        await time.advanceBlockTo((await time.latestBlock()).toNumber() + 5);

        assert.equal(await web3.eth.getStorageAt(aaveGovernance.address, "0x3333"), toEvmBytes32(0));

        let res = await aaveGovernance.resolveProposal(0, { from: lendToken });
        await expectEvent.inTransaction(res.tx, AaveProtoGovernance, "YesWins", {
          proposalId: "0"
        });
        await expectEvent.inTransaction(res.tx, AIP2ProposalPayload, "ProposalExecuted", {
          caller: lendToken
        });

        const proposal = await aaveGovernance.getProposalBasicData(0);
        assert.equal(proposal._proposalStatus, 3);

        assert.equal(
          await web3.eth.getStorageAt(aaveGovernance.address, "0x3333"),
          "0x000000000000000000000000000000000000000000000000000000000000002a"
        );
      });
    });
  });
});
