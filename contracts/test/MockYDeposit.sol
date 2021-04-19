// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYDeposit.sol";

contract MockYDeposit is IYDeposit {
  IERC20 public CRV;
  IERC20 public USDC;

  uint256 public usdcCrvRateNumerator = 9;
  uint256 public usdcCrvRateDenominator = 10;

  constructor(IERC20 _CRV, IERC20 _USDC) public {
    CRV = _CRV;
    USDC = _USDC;
  }

  function setRatio(uint256 _usdcCrvRateNumerator, uint256 _usdcCrvRateDenominator) external {
    usdcCrvRateNumerator = _usdcCrvRateNumerator;
    usdcCrvRateDenominator = _usdcCrvRateDenominator;
  }

  function remove_liquidity_one_coin(
    uint256 tokenAmount,
    int128 i,
    uint256,
    bool donateDust
  ) external override {
    require(i == 1, "MockYDeposit: invalid i");
    require(donateDust == true, "MockYDeposit: donate dust should be true");

    uint256 amountOut = calc_withdraw_one_coin(tokenAmount, i);

    require(IERC20(CRV).balanceOf(msg.sender) >= tokenAmount, "NOT_ENOUGH_CRV");
    CRV.transferFrom(msg.sender, address(this), tokenAmount);
    require(IERC20(USDC).balanceOf(address(this)) >= amountOut, "NOT_ENOUGH_USDC");
    USDC.transfer(msg.sender, amountOut);
  }

  function calc_withdraw_one_coin(uint256 _crvTokenAmount, int128 _i) public override returns (uint256) {
    _i;
    // adjust the value to 6 symbol precision of USDC
    return (_crvTokenAmount * usdcCrvRateNumerator) / usdcCrvRateDenominator / 1e12;
  }
}
