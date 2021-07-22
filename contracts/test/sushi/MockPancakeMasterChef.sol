// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPancakeMasterChef {
  address token;

  constructor(address _token) public {
    token = _token;
  }

  function enterStaking(uint256 _amount) external {
    IERC20(token).transferFrom(msg.sender, address(42), _amount);
  }

  function leaveStaking(uint256) external {}

  function userInfo(uint256, address) external view returns (uint256 amount, uint256 rewardDebt) {
    return (0, 0);
  }
}
