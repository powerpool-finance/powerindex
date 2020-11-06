
pragma solidity 0.6.12;

import "./PiBPoolAbstractController.sol";
import "./WrappedPiErc20.sol";
import "@nomiclabs/buidler/console.sol";


contract PiBPoolController is PiBPoolAbstractController {

    constructor(address _bpool) public PiBPoolAbstractController(_bpool) {

    }

    function replacePoolTokenByWrapped(
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

    function replacePoolTokenByNewVersion(
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

        IERC20(_newToken).approve(address(bpool), balance);
        bpool.bind(_newToken, balance, denormalizedWeight);
    }
}