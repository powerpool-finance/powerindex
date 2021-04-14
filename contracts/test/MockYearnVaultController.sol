// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockYearnVaultController {
  using SafeMath for uint256;
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
    uint256 calculated = (_amount * withdrawNominator) / withdrawDenominator;
    balanceOf[_crvToken] = balanceOf[_crvToken].sub(calculated);
    IERC20(_crvToken).transfer(msg.sender, calculated);
  }
}
