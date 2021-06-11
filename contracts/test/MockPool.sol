// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";

contract MockPool {
  address[] internal currentTokens;

  constructor() public {
    currentTokens.push(address(1));
    currentTokens.push(address(2));
    currentTokens.push(address(3));
  }

  function gulp(address _token) public {}

  function setCurrentTokens(address[] calldata _currentTokens) external {
    currentTokens = _currentTokens;
  }

  function transfer(
    address _token,
    address _receiver,
    uint256 _amount
  ) public {
    IERC20(_token).transfer(_receiver, _amount);
  }

  function getCurrentTokens() external view returns (address[] memory tokens) {
    return currentTokens;
  }
}
