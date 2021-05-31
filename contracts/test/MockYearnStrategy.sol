// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../interfaces/IYearnVaultV2.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract MockYearnStrategy {
  using SafeMath for uint256;

  IYearnVaultV2 public vault;
  IERC20 public want;

  uint256 numerator;
  uint256 denominator;

  constructor(address _vault) public {
    vault = IYearnVaultV2(_vault);
    want = IERC20(vault.token());
    numerator = 9;
    denominator = 10;
  }

  function delegatedAssets() external view virtual returns (uint256) {
    return 0;
  }

  function balanceOfWant() public view returns (uint256) {
    return want.balanceOf(address(this));
  }

  function balanceOfPool() public view returns (uint256) {
    // DO NOT TRANSFER ANYWHERE
    return 0;
  }

  function estimatedTotalAssets() public view returns (uint256) {
    return balanceOfWant().add(balanceOfPool());
  }

  function harvest() external {
    uint256 debtOutstanding = vault.report({ gain: 0, loss: 0, debtPayment: 0 });
  }

  function setWithdrawalLossRate(uint256 _numerator, uint256 _denominator) external {
    numerator = _numerator;
    denominator = _denominator;
  }

  function withdraw(uint256 _amountNeeded) external returns (uint256 _loss) {
    require(msg.sender == address(vault), "!vault");
    uint256 amountFreed = (_amountNeeded * numerator) / denominator;
    want.transfer(msg.sender, amountFreed);
    _loss = _amountNeeded.sub(amountFreed);
  }
}
