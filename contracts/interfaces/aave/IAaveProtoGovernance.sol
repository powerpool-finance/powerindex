// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IAaveProtoGovernance {
  function newProposal(
    bytes32 _proposalType,
    bytes32 _ipfsHash,
    uint256 _threshold,
    address _proposalExecutor,
    uint256 _votingBlocksDuration,
    uint256 _validatingBlocksDuration,
    uint256 _maxMovesToVotingAllowed
  ) external;
  function submitVoteByVoter(uint256 _proposalId, uint256 _vote, IERC20 _asset) external;
  function submitVoteByRelayer(
    uint256 _proposalId,
    uint256 _vote,
    address _voter,
    IERC20 _asset,
    uint256 _nonce,
    bytes calldata _signature,
    bytes32 _paramsHashByVoter
  ) external;
  function cancelVoteByVoter(uint256 _proposalId) external;
  function cancelVoteByRelayer(
    uint256 _proposalId,
    address _voter,
    uint256 _nonce,
    bytes calldata _signature,
    bytes32 _paramsHashByVoter
  ) external;
  function tryToMoveToValidating(uint256 _proposalId) external;
  function challengeVoters(uint256 _proposalId, address[] calldata _voters) external;
  function resolveProposal(uint256 _proposalId) external;

  function getLimitBlockOfProposal(uint256 _proposalId) external view returns(uint256 _limitBlockProposal);
  function getLeadingChoice(uint256 _proposalId) external view returns(uint256);
  function getProposalBasicData(uint256 _proposalId) external view returns(
    uint256 _totalVotes,
    uint256 _threshold,
    uint256 _maxMovesToVotingAllowed,
    uint256 _movesToVoting,
    uint256 _votingBlocksDuration,
    uint256 _validatingBlocksDuration,
    uint256 _currentStatusInitBlock,
    uint256 _initProposalBlock,
    uint256 _proposalStatus,
    address _proposalExecutor,
    bytes32 _proposalType
  );
  function getVoterData(uint256 _proposalId, address _voterAddress) external view returns(
    uint256 _vote,
    uint256 _weight,
    uint256 _balance,
    uint256 _nonce,
    IERC20 _asset
  );
  function getVotesData(uint256 _proposalId) external view returns(uint256[3] memory);
  function getGovParamsProvider() external view returns(address _govParamsProvider);

  function verifyParamsConsistencyAndSignature(
    bytes32 _paramsHashByRelayer,
    bytes32 _paramsHashBySigner,
    bytes calldata _signature,
    address _signer
  ) external pure;
  function verifyNonce(uint256 _proposalId, address _voter, uint256 _relayerNonce) external view;
  function validateRelayAction(
    bytes32 _paramsHashByRelayer,
    bytes32 _paramsHashBySigner,
    bytes calldata _signature,
    address _signer,
    uint256 _proposalId,
    uint256 _relayerNonce
  ) external view;
}
