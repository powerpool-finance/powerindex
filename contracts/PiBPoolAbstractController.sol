
pragma solidity 0.6.12;

import "./interfaces/PiDynamicBPoolInterface.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract PiBPoolAbstractController is Ownable {
    using SafeMath for uint256;

    event CallPool(bool indexed success, bytes4 indexed inputSig, bytes inputData, bytes outputData);

    PiDynamicBPoolInterface public immutable bpool;

    constructor(address _bpool) public {
        bpool = PiDynamicBPoolInterface(_bpool);
    }

    function callPool(bytes4 signature, bytes calldata args, uint value) external onlyOwner {
        (bool success, bytes memory data) = address(bpool).call{ value: value }(abi.encodePacked(signature, args));
        require(success, "NOT_SUCCESS");
        emit CallPool(success, signature, args, data);
    }

    function migratePoolController(address _newController) external onlyOwner {
        bpool.setController(_newController);
    }
}