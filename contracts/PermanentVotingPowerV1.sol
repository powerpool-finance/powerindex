// SPDX-License-Identifier: MIT

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

  constructor() public Ownable() {}

  function setFeeManager(address _feeManager) public onlyOwner {
    feeManager = _feeManager;

    emit SetFeeManager(_feeManager);
  }

  function withdraw(
    address[] calldata _tokens,
    uint256[] calldata _amounts,
    address _to
  ) external onlyFeeManager {
    uint256 len = _tokens.length;
    require(len == _amounts.length, "Arrays lengths are not equals");

    for (uint256 i = 0; i < len; i++) {
      IERC20(_tokens[i]).transfer(_to, _amounts[i]);
    }
  }
}
