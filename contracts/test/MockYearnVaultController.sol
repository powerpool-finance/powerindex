// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockYearnVaultController {
  mapping(address => uint256) public balanceOf;
  uint256 public withdrawNominator = 1;
  uint256 public withdrawDenominator = 1;

  function earn(address _crvToken, uint256 _amount) external {
    balanceOf[_crvToken] += _amount;
  }

  function setWithdrawRatio(uint256 _withdrawNominator, uint256 _withdrawDenominator) external {
    withdrawDenominator = _withdrawDenominator;
    withdrawNominator = _withdrawNominator;
  }

  function withdraw(address _crvToken, uint256 _amount) external {
    IERC20(_crvToken).transfer(msg.sender, (_amount * withdrawNominator) / withdrawDenominator);
  }
}
