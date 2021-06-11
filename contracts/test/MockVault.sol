// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./MockERC20.sol";

contract MockVault is MockERC20 {
  uint256 public totalAssets;
  IERC20 public token;

  constructor(
    address _token,
    uint256 _totalAssets,
    uint256 _supply
  ) public MockERC20("", "", 18, _supply) {
    token = IERC20(_token);
    totalAssets = _totalAssets;
  }

  function deposit(uint256 _amount) public {
    token.transferFrom(msg.sender, address(this), _amount);
    mint(msg.sender, _amount.mul(1 ether).div(pricePerShare()));
  }

  function withdraw(uint256 _amount) public {
    burn(_amount);
    token.transfer(msg.sender, _amount.mul(pricePerShare()).div(1 ether));
  }

  function setTotalAssets(uint256 _totalAssets) public {
    totalAssets = _totalAssets;
  }

  function pricePerShare() public view returns (uint256) {
    return totalAssets.mul(1e18).div(totalSupply());
  }
}
