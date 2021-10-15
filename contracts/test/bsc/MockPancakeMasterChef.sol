// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPancakeMasterChef {
  address token;
  bool doTransfer;

  constructor(address _token) public {
    token = _token;
    doTransfer = true;
  }

  function setDoTransfer(bool _doTransfer) external {
    doTransfer = _doTransfer;
  }

  function enterStaking(uint256 _amount) external {
    if (doTransfer) {
      IERC20(token).transferFrom(msg.sender, address(42), _amount);
    }
  }

  function leaveStaking(uint256) external {}

  function userInfo(uint256, address) external pure returns (uint256 amount, uint256 rewardDebt) {
    return (0, 0);
  }
}
