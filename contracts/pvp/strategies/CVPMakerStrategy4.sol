// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../Erc20VaultPoolSwap.sol";
import "../../interfaces/ICVPMakerStrategy.sol";
import "../../interfaces/IYearnVaultV2.sol";
import "../../interfaces/ICVPMakerViewer.sol";

/**
 * @notice Unwraps YearnVaultV2 tokens into USDC, then swaps it to CVP using Uniswap strategy,
 */
contract CVPMakerStrategy4 is ICVPMakerStrategy {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address public immutable USDC;
  address public immutable vaultSwap;
  // 100% == 1 ether; for ex. for 1% extra usdc to unwrap set to 1.01 ether
  uint256 public immutable extraOutPct;

  constructor(
    address usdc_,
    address vaultSwap_,
    uint256 extraOutPct_
  ) public {
    USDC = usdc_;
    vaultSwap = vaultSwap_;
    extraOutPct = extraOutPct_;
  }

  /**
   * @notice Executes the strategy.
   * @dev Does not use the config argument.
   * @dev Should be call using `delegatecall` only.
   * @param vaultTokenIn_ the address of the YEarnV2 vault token to exit
   * @return vaultIn amountIn in vault tokens
   * @return executeUniLikeFrom always USDC
   */
  function executeStrategy(address vaultTokenIn_, bytes memory config_)
    external
    override
    returns (uint256 vaultIn, address executeUniLikeFrom)
  {
    vaultIn = estimateIn(address(this), vaultTokenIn_, config_);

    require(IERC20(vaultTokenIn_).balanceOf(address(this)) > vaultIn, "INSUFFICIENT_VAULT_AMOUNT_IN");

    IERC20(vaultTokenIn_).approve(vaultSwap, vaultIn);
    uint256 usdcOut = Erc20VaultPoolSwap(vaultSwap).swapVaultToUSDC(vaultTokenIn_, vaultIn);
    executeUniLikeFrom = USDC;
  }

  /**
   * @notice Estimates required amountIn in vault tokens to exit for cvpAmountOut
   * @dev Does not use the config argument
   * @param cvpMaker_ the address of the CVPMaker contract
   * @param vaultTokenIn_ the address of the YEarnV2 vault token to exit
   * @return amountIn in vault tokens
   */
  function estimateIn(
    address cvpMaker_,
    address vaultTokenIn_,
    bytes memory
  ) public view override returns (uint256) {
    // Assume that the USDC out price is roughly equal to the virtual price
    uint256 usdcUniIn = ICVPMakerViewer(cvpMaker_).estimateUniLikeStrategyIn(USDC);

    return Erc20VaultPoolSwap(vaultSwap).calcVaultOutByUsdc(vaultTokenIn_, usdcUniIn).mul(extraOutPct) / 1 ether;
  }
}
