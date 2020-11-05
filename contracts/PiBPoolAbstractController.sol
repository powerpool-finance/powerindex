
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

    function callPool(bytes4 signature, bytes calldata args, uint value) external onlyOwner {
        require(signature != UNBIND_SIG && signature != CALL_VOTING_SIG, "SIGNATURE_NOT_ALLOWED");
        (bool success, bytes memory data) = address(bpool).call{ value: value }(abi.encodePacked(signature, args));
        require(success, "NOT_SUCCESS");
        emit CallPool(success, signature, args, data);
    }

    function callVotingByPool(address voting, bytes4 signature, bytes calldata args, uint value) external {
        require(_restrictions().isVotingSenderAllowed(voting, msg.sender), "SENDER_NOT_ALLOWED");
        bpool.callVoting(voting, signature, args, value);
    }

    function migrateController(address _newController, address[] calldata _addressesToMigrate) external onlyOwner {
        uint len = _addressesToMigrate.length;
        for (uint256 i = 0; i < len; i++) {
            PiDynamicBPoolInterface(_addressesToMigrate[i]).setController(_newController);
        }
    }

    function _restrictions() internal returns(IPoolRestrictions) {
        return IPoolRestrictions(bpool.getRestrictions());
    }
}