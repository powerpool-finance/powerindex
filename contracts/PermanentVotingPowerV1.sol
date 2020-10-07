pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract PermanentVotingPowerV1 is Ownable {

    address public feeManager;

    event SetFeeManager(address indexed addr);

    modifier onlyFeeManager() {
        require(msg.sender == feeManager, "NOT_FEE_MANAGER");
        _;
    }

    constructor() public Ownable() {

    }

    function setFeeManager(address _feeManager) public onlyOwner {
        feeManager = _feeManager;

        emit SetFeeManager(_feeManager);
    }

    function withdraw(address _token, address _to, uint256 _amount) onlyFeeManager external {
        IERC20(_token).transfer(_to, _amount);
    }
}