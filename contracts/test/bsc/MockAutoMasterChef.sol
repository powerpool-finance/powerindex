// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockAutoMasterChef {
  address token;
  uint256 swt;

  constructor(address _token, uint256 _swt) public {
    token = _token;
    swt = _swt;
  }

  function deposit(uint256, uint256 _amount) external {
    IERC20(token).transferFrom(msg.sender, address(42), _amount);
  }

  function withdraw(uint256, uint256) external {}

  function stakedWantTokens(uint256, address) external view returns (uint256) {
    return swt;
  }

  function poolInfo(uint256)
    external
    view
    returns (
      address want,
      uint256 allocPoint,
      uint256 lastRewardBlock,
      uint256 accAUTOPerShare,
      address strat
    )
  {
    return (address(0), 0, 0, 0, strat);
  }

  function userInfo(uint256, address) external view returns (uint256 amount, uint256 rewardDebt) {
    return (0, 0);
  }
}
