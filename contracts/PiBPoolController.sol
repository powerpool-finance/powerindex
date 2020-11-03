
pragma solidity 0.6.12;

import "./interfaces/BPoolInterface.sol";
import "./WrappedPiErc20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract PiBPoolController is Ownable {
    using SafeMath for uint256;

    BPoolInterface public immutable bpool;

    event CallPool(bool indexed success, bytes4 indexed inputSig, bytes inputData, bytes outputData);

    constructor(address _bpool) public {
        bpool = BPoolInterface(_bpool);
    }

    function replacePoolTokenWithWrapped(
        address _token,
        address _router,
        string calldata _name,
        string calldata _symbol
    )
        external
        onlyOwner
    {
        WrappedPiErc20 wrappedToken = new WrappedPiErc20(_token, _router, _name, _symbol);
        uint256 denormalizedWeight = bpool.getDenormalizedWeight(_token);
        uint256 balance = bpool.getBalance(_token);

        bpool.unbind(_token);

        IERC20(_token).approve(address(wrappedToken), balance);
        wrappedToken.deposit(balance);

        wrappedToken.approve(address(bpool), balance);
        bpool.bind(address(wrappedToken), balance, denormalizedWeight);
    }

    function replacePoolTokenWithNewVersion(
        address _oldToken,
        address _newToken,
        address _migrator,
        bytes calldata _migratorData
    )
        external
        onlyOwner
    {
        uint256 denormalizedWeight = bpool.getDenormalizedWeight(_oldToken);
        uint256 balance = bpool.getBalance(_oldToken);

        bpool.unbind(_oldToken);

        IERC20(_oldToken).approve(_migrator, balance);
        (bool success, bytes memory data) = _migrator.call(_migratorData);
        require(success, "NOT_SUCCESS");

        require(
            IERC20(_newToken).balanceOf(address(this)) >= balance,
            "PiBPoolController:newVersion: insufficient newToken balance"
        );

        IERC20(_newToken).approve(address(bpool), balance);
        bpool.bind(_newToken, balance, denormalizedWeight);
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
