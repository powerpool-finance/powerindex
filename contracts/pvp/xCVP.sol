// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract xCVP is ERC20("Permanent Voting Power", "xCVP") {
  using SafeMath for uint256;
  IERC20 public immutable cvp;

  constructor(IERC20 cvp_) public {
    cvp = cvp_;
  }

  function enter(uint256 _amount) public {
    uint256 totalSushi = cvp.balanceOf(address(this));
    uint256 totalShares = totalSupply();
    if (totalShares == 0 || totalSushi == 0) {
      _mint(msg.sender, _amount);
    } else {
      uint256 what = _amount.mul(totalShares).div(totalSushi);
      _mint(msg.sender, what);
    }
    cvp.transferFrom(msg.sender, address(this), _amount);
  }

  function leave(uint256 _share) public {
    uint256 totalShares = totalSupply();
    uint256 what = _share.mul(cvp.balanceOf(address(this))).div(totalShares);
    _burn(msg.sender, _share);
    cvp.transfer(msg.sender, what);
  }

  function name() public view override returns (string memory) {
    return "Permanent Voting Power";
  }

  function symbol() public view override returns (string memory) {
    return "xCVP";
  }

  function decimals() public view override returns (uint8) {
    return uint8(18);
  }
}
