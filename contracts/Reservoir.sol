// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Reservoir is Ownable {
  constructor() public Ownable() {}

  function setApprove(
    address _token,
    address _to,
    uint256 _amount
  ) external onlyOwner {
    IERC20(_token).approve(_to, _amount);
  }
}
