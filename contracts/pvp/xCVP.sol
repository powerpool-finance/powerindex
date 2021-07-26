// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract xCVP is ERC20("", "") {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;
  IERC20 public immutable cvp;

  constructor(IERC20 cvp_) public {
    cvp = cvp_;
  }

  /**
   * @notice Deposits CVP token to receive xCVP
   * @param _amount CVP amount to deposit
   * @return shareMinted The minted xCVP amount
   */
  function enter(uint256 _amount) external returns (uint256 shareMinted) {
    uint256 totalCVP = cvp.balanceOf(address(this));
    uint256 totalShares = totalSupply();
    if (totalShares == 0 || totalCVP == 0) {
      shareMinted = _amount;
    } else {
      shareMinted = _amount.mul(totalShares).div(totalCVP);
    }
    _mint(msg.sender, shareMinted);
    cvp.safeTransferFrom(msg.sender, address(this), _amount);
  }

  /**
   * @notice Burn xCVP token to withdraw CVP
   * @param _share xCVP amount to burn
   * @return shareMinted The sent CVP amount
   */
  function leave(uint256 _share) external returns (uint256 cvpSent) {
    uint256 totalShares = totalSupply();
    cvpSent = _share.mul(cvp.balanceOf(address(this))).div(totalShares);
    _burn(msg.sender, _share);
    cvp.safeTransfer(msg.sender, cvpSent);
  }

  function name() public view override returns (string memory) {
    return "Permanent Voting Power Token";
  }

  function symbol() public view override returns (string memory) {
    return "xCVP";
  }

  function decimals() public view override returns (uint8) {
    return uint8(18);
  }
}
