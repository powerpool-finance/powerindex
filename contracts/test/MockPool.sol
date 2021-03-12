// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";

contract MockPool {
  constructor() public {}

  function gulp(address _token) public {}

  function transfer(
    address _token,
    address _receiver,
    uint256 _amount
  ) public {
    IERC20(_token).transfer(_receiver, _amount);
  }
}
