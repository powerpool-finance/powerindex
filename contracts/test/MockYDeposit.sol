// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYDeposit.sol";

contract MockYDeposit is IYDeposit {
  IERC20 public YCRV;
  IERC20 public USDC;

  constructor(IERC20 _YCRV, IERC20 _USDC) public {
    YCRV = _YCRV;
    USDC = _USDC;
  }

  function remove_liquidity_one_coin(
    uint256 tokenAmount,
    int128 i,
    uint256,
    bool donateDust
  ) external override {
    require(i == 1, "MockYDeposit: invalid i");
    require(donateDust == true, "MockYDeposit: donate dust should be true");

    uint256 amountOut = (tokenAmount * 9) / 10;
    // adjust the value to 6 symbol precision of USDC
    amountOut = amountOut / 1e12;
    YCRV.transferFrom(msg.sender, address(this), tokenAmount);
    USDC.transfer(msg.sender, amountOut);
  }
}
