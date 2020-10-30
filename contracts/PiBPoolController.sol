
pragma solidity 0.6.12;

import "./interfaces/BPoolInterface.sol";
import "./WrappedPiErc20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@nomiclabs/buidler/console.sol";


contract PiBPoolController is Ownable {
    using SafeMath for uint256;

    BPoolInterface public immutable bpool;

    constructor(address _bpool) public {
        bpool = BPoolInterface(_bpool);
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
}