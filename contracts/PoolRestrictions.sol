// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IPoolRestrictions.sol";

contract PoolRestrictions is IPoolRestrictions, Ownable {
  /* ==========  EVENTS  ========== */

  /** @dev Emitted on changing total restrictions for token. */
  event SetTotalRestrictions(address indexed token, uint256 maxTotalSupply);

  /** @dev Emitted on changing signature restriction. */
  event SetSignatureAllowed(bytes4 indexed signature, bool allowed);

  /** @dev Emitted on changing signature restriction for specific voting. */
  event SetSignatureAllowedForAddress(
    address indexed voting,
    bytes4 indexed signature,
    bool allowed,
    bool overrideAllowed
  );

  /** @dev Emitted on adding or removing sender for voting execution. */
  event SetVotingSenderAllowed(address indexed voting, address indexed sender, bool allowed);

  /** @dev Emitted on adding or removing operators without fees. */
  event SetWithoutFee(address indexed addr, bool withoutFee);

  /* ==========  Storage  ========== */

  struct TotalRestrictions {
    uint256 maxTotalSupply;
  }
  /** @dev Public records of restrictions by pool's addresses. */
  mapping(address => TotalRestrictions) public totalRestrictions;

  /** @dev Public records of general signature's restrictions. */
  mapping(bytes4 => bool) public signaturesAllowed;

  struct VotingSignature {
    bool allowed;
    bool overrideAllowed;
  }
  /** @dev Public records of signature's restrictions by specific votings. */
  mapping(address => mapping(bytes4 => VotingSignature)) public votingSignatures;

  /** @dev Public records of senders allowed by voting's addresses */
  mapping(address => mapping(address => bool)) public votingSenderAllowed;

  /** @dev Public records of operators, who doesn't pay community fee */
  mapping(address => bool) public withoutFeeAddresses;

  constructor() public Ownable() {}

  /* ==========  Configuration Actions  ========== */

  /**
   * @dev Set total restrictions for pools list.
   * @param _poolsList List of pool's addresses.
   * @param _maxTotalSupplyList List of total supply limits for each pool address.
   */
  function setTotalRestrictions(address[] calldata _poolsList, uint256[] calldata _maxTotalSupplyList)
    external
    onlyOwner
  {
    _setTotalRestrictions(_poolsList, _maxTotalSupplyList);
  }

  /**
   * @dev Set voting signatures allowing status.
   * @param _signatures List of signatures.
   * @param _allowed List of booleans (allowed or not) for each signature.
   */
  function setVotingSignatures(bytes4[] calldata _signatures, bool[] calldata _allowed) external onlyOwner {
    _setVotingSignatures(_signatures, _allowed);
  }

  /**
   * @dev Set signatures allowing status for specific votings.
   * @param _votingAddress Specific voting address.
   * @param _override Override signature status by specific voting address or not.
   * @param _signatures List of signatures.
   * @param _allowed List of booleans (allowed or not) for each signature.
   */
  function setVotingSignaturesForAddress(
    address _votingAddress,
    bool _override,
    bytes4[] calldata _signatures,
    bool[] calldata _allowed
  ) external onlyOwner {
    _setVotingSignaturesForAddress(_votingAddress, _override, _signatures, _allowed);
  }

  /**
   * @dev Set senders allowing status for voting's addresses.
   * @param _votingAddress Specific voting address.
   * @param _senders List of senders.
   * @param _allowed List of booleans (allowed or not) for each sender.
   */
  function setVotingAllowedForSenders(
    address _votingAddress,
    address[] calldata _senders,
    bool[] calldata _allowed
  ) external onlyOwner {
    uint256 len = _senders.length;
    _validateArrayLength(len);
    require(len == _allowed.length, "Arrays lengths are not equals");
    for (uint256 i = 0; i < len; i++) {
      votingSenderAllowed[_votingAddress][_senders[i]] = _allowed[i];
      emit SetVotingSenderAllowed(_votingAddress, _senders[i], _allowed[i]);
    }
  }

  /**
   * @dev Set operators, who doesn't pay community fee.
   * @param _addresses List of operators.
   * @param _withoutFee Boolean for whole list of operators.
   */
  function setWithoutFee(address[] calldata _addresses, bool _withoutFee) external onlyOwner {
    uint256 len = _addresses.length;
    _validateArrayLength(len);
    for (uint256 i = 0; i < len; i++) {
      withoutFeeAddresses[_addresses[i]] = _withoutFee;
      emit SetWithoutFee(_addresses[i], _withoutFee);
    }
  }

  /* ==========  Config Queries  ========== */

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
    _validateArrayLength(len);
    require(len == _maxTotalSupplyList.length, "Arrays lengths are not equals");

    for (uint256 i = 0; i < len; i++) {
      totalRestrictions[_poolsList[i]] = TotalRestrictions(_maxTotalSupplyList[i]);
      emit SetTotalRestrictions(_poolsList[i], _maxTotalSupplyList[i]);
    }
  }

  function _setVotingSignatures(bytes4[] memory _signatures, bool[] memory _allowed) internal {
    uint256 len = _signatures.length;
    _validateArrayLength(len);
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
    _validateArrayLength(len);
    require(len == _allowed.length, "Arrays lengths are not equals");

    for (uint256 i = 0; i < len; i++) {
      votingSignatures[_votingAddress][_signatures[i]] = VotingSignature(_allowed[i], _override);
      emit SetSignatureAllowedForAddress(_votingAddress, _signatures[i], _allowed[i], _override);
    }
  }

  function _validateArrayLength(uint256 _len) internal {
    require(_len <= 100, "Array length should be less or equal 100");
  }
}
