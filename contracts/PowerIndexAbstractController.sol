// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/PowerIndexPoolInterface.sol";
import "./interfaces/IPoolRestrictions.sol";

contract PowerIndexAbstractController is Ownable {
  using SafeMath for uint256;

  bytes4 public constant CALL_VOTING_SIG = bytes4(keccak256(bytes("callVoting(address,bytes4,bytes,uint256)")));

  event CallPool(bool indexed success, bytes4 indexed inputSig, bytes inputData, bytes outputData);

  PowerIndexPoolInterface public immutable pool;

  constructor(address _pool) public {
    pool = PowerIndexPoolInterface(_pool);
  }

  /**
   * @notice Call any function from pool, except prohibited signatures
   * @param signature Method signature
   * @param args Encoded method inputs
   * @param value Send value to pool
   */
  function callPool(
    bytes4 signature,
    bytes calldata args,
    uint256 value
  ) external onlyOwner {
    _checkSignature(signature);
    (bool success, bytes memory data) = address(pool).call{ value: value }(abi.encodePacked(signature, args));
    require(success, "NOT_SUCCESS");
    emit CallPool(success, signature, args, data);
  }

  /**
   * @notice Call voting by pool
   * @param voting Voting address
   * @param signature Method signature
   * @param args Encoded method inputs
   * @param value Send value to pool
   */
  function callVotingByPool(
    address voting,
    bytes4 signature,
    bytes calldata args,
    uint256 value
  ) external {
    require(_restrictions().isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
    pool.callVoting(voting, signature, args, value);
  }

  /**
   * @notice Migrate several contracts with setController method to new controller address
   * @param newController New controller to migrate
   * @param addressesToMigrate Address to call setController method
   */
  function migrateController(address newController, address[] calldata addressesToMigrate) external onlyOwner {
    uint256 len = addressesToMigrate.length;
    for (uint256 i = 0; i < len; i++) {
      PowerIndexPoolInterface(addressesToMigrate[i]).setController(newController);
    }
  }

  function _restrictions() internal view returns (IPoolRestrictions) {
    return IPoolRestrictions(pool.getRestrictions());
  }

  function _checkSignature(bytes4 signature) internal pure virtual {
    require(signature != CALL_VOTING_SIG, "SIGNATURE_NOT_ALLOWED");
  }
}
