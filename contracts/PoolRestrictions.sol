// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IPoolRestrictions.sol";

contract PoolRestrictions is IPoolRestrictions, Ownable {
  event SetTotalRestrictions(address indexed token, uint256 maxTotalSupply);
  event SetSignatureAllowed(bytes4 indexed signature, bool allowed);
  event SetSignatureAllowedForAddress(
    address indexed voting,
    bytes4 indexed signature,
    bool allowed,
    bool overrideAllowed
  );
  event SetVotingSenderAllowed(address indexed voting, address indexed sender, bool allowed);
  event SetWithoutFee(address indexed addr, bool withoutFee);

  struct TotalRestrictions {
    uint256 maxTotalSupply;
  }
  // token => restrictions
  mapping(address => TotalRestrictions) public totalRestrictions;

  // signature => allowed
  mapping(bytes4 => bool) public signaturesAllowed;

  struct VotingSignature {
    bool allowed;
    bool overrideAllowed;
  }
  // votingAddress => signature => data
  mapping(address => mapping(bytes4 => VotingSignature)) public votingSignatures;
  // votingAddress => sender => boolean
  mapping(address => mapping(address => bool)) public votingSenderAllowed;

  mapping(address => bool) public withoutFeeAddresses;

  constructor() public Ownable() {}

  function setTotalRestrictions(address[] calldata _poolsList, uint256[] calldata _maxTotalSupplyList)
    external
    onlyOwner
  {
    _setTotalRestrictions(_poolsList, _maxTotalSupplyList);
  }

  function setVotingSignatures(bytes4[] calldata _signatures, bool[] calldata _allowed) external onlyOwner {
    _setVotingSignatures(_signatures, _allowed);
  }

  function setVotingSignaturesForAddress(
    address _votingAddress,
    bool _override,
    bytes4[] calldata _signatures,
    bool[] calldata _allowed
  ) external onlyOwner {
    _setVotingSignaturesForAddress(_votingAddress, _override, _signatures, _allowed);
  }

  function setVotingAllowedForSenders(
    address _votingAddress,
    address[] calldata _senders,
    bool[] calldata _allowed
  ) external onlyOwner {
    uint256 len = _senders.length;
    require(len == _allowed.length, "Arrays lengths are not equals");
    for (uint256 i = 0; i < len; i++) {
      votingSenderAllowed[_votingAddress][_senders[i]] = _allowed[i];
      emit SetVotingSenderAllowed(_votingAddress, _senders[i], _allowed[i]);
    }
  }

  function setWithoutFee(address[] calldata _addresses, bool _withoutFee) external onlyOwner {
    uint256 len = _addresses.length;
    for (uint256 i = 0; i < len; i++) {
      withoutFeeAddresses[_addresses[i]] = _withoutFee;
      emit SetWithoutFee(_addresses[i], _withoutFee);
    }
  }

  function getMaxTotalSupply(address _poolAddress) external view override returns (uint256) {
    return totalRestrictions[_poolAddress].maxTotalSupply;
  }

  function isVotingSignatureAllowed(address _votingAddress, bytes4 _signature) external view override returns (bool) {
    if (votingSignatures[_votingAddress][_signature].overrideAllowed) {
      return votingSignatures[_votingAddress][_signature].allowed;
    } else {
      return signaturesAllowed[_signature];
    }
  }

  function isVotingSenderAllowed(address _votingAddress, address _sender) external view override returns (bool) {
    return votingSenderAllowed[_votingAddress][_sender];
  }

  function isWithoutFee(address _address) external view override returns (bool) {
    return withoutFeeAddresses[_address];
  }

  /*** Internal Functions ***/

  function _setTotalRestrictions(address[] memory _poolsList, uint256[] memory _maxTotalSupplyList) internal {
    uint256 len = _poolsList.length;
    require(len == _maxTotalSupplyList.length, "Arrays lengths are not equals");

    for (uint256 i = 0; i < len; i++) {
      totalRestrictions[_poolsList[i]] = TotalRestrictions(_maxTotalSupplyList[i]);
      emit SetTotalRestrictions(_poolsList[i], _maxTotalSupplyList[i]);
    }
  }

  function _setVotingSignatures(bytes4[] memory _signatures, bool[] memory _allowed) internal {
    uint256 len = _signatures.length;
    require(len == _allowed.length, "Arrays lengths are not equals");

    for (uint256 i = 0; i < len; i++) {
      signaturesAllowed[_signatures[i]] = _allowed[i];
      emit SetSignatureAllowed(_signatures[i], _allowed[i]);
    }
  }

  function _setVotingSignaturesForAddress(
    address _votingAddress,
    bool _override,
    bytes4[] memory _signatures,
    bool[] memory _allowed
  ) internal {
    uint256 len = _signatures.length;
    require(len == _allowed.length, "Arrays lengths are not equals");

    for (uint256 i = 0; i < len; i++) {
      votingSignatures[_votingAddress][_signatures[i]] = VotingSignature(_allowed[i], _override);
      emit SetSignatureAllowedForAddress(_votingAddress, _signatures[i], _allowed[i], _override);
    }
  }
}
