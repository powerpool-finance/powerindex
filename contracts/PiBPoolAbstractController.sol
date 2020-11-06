
pragma solidity 0.6.12;

import "./interfaces/PiDynamicBPoolInterface.sol";
import "./IPoolRestrictions.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract PiBPoolAbstractController is Ownable {
    using SafeMath for uint256;

    bytes4 public constant UNBIND_SIG = bytes4(keccak256(bytes('unbind(address)')));
    bytes4 public constant CALL_VOTING_SIG = bytes4(keccak256(bytes('callVoting(address,bytes4,bytes,uint)')));

    event CallPool(bool indexed success, bytes4 indexed inputSig, bytes inputData, bytes outputData);

    PiDynamicBPoolInterface public immutable bpool;

    constructor(address _bpool) public {
        bpool = PiDynamicBPoolInterface(_bpool);
    }

    /**
    * @notice Call any function from pool, except prohibited signatures
    * @param signature Method signature
    * @param args Encoded method inputs
    * @param value Send value to pool
    */
    function callPool(bytes4 signature, bytes calldata args, uint value) external onlyOwner {
        require(signature != UNBIND_SIG && signature != CALL_VOTING_SIG, "SIGNATURE_NOT_ALLOWED");
        (bool success, bytes memory data) = address(bpool).call{ value: value }(abi.encodePacked(signature, args));
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
    function callVotingByPool(address voting, bytes4 signature, bytes calldata args, uint value) external {
        require(_restrictions().isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
        bpool.callVoting(voting, signature, args, value);
    }

    /**
    * @notice Migrate several contracts with setController method to new controller address
    * @param newController New controller to migrate
    * @param addressesToMigrate Address to call setController method
    */
    function migrateController(address newController, address[] calldata addressesToMigrate) external onlyOwner {
        uint len = addressesToMigrate.length;
        for (uint256 i = 0; i < len; i++) {
            PiDynamicBPoolInterface(addressesToMigrate[i]).setController(newController);
        }
    }

    function _restrictions() internal returns(IPoolRestrictions) {
        return IPoolRestrictions(bpool.getRestrictions());
    }
}