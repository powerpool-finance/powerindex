// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../interfaces/IErc20VaultPoolSwap.sol";
import "../../interfaces/IIndiciesSupplyRedeemZap.sol";
import "../../interfaces/IYearnVaultV2.sol";
import "../../interfaces/ICVPMakerViewer.sol";
import "../../interfaces/ICVPMakerStrategy.sol";

/**
 * @notice Unwraps YearnVaultV2 tokens into USDC, then swaps it to CVP using Uniswap strategy,
 */
contract CVPMakerZapStrategy is ICVPMakerStrategy {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address public immutable tokenOut;
  IIndiciesSupplyRedeemZap public immutable zap;
  // 100% == 1 ether; for ex. for 1% extra usdc to unwrap set to 1.01 ether
  uint256 public immutable extraOutPct;

  constructor(
    address tokenOut_,
    address zap_,
    uint256 extraOutPct_
  ) public {
    tokenOut = tokenOut_;
    zap = IIndiciesSupplyRedeemZap(zap_);
    extraOutPct = extraOutPct_;
  }

  /**
   * @notice Executes the strategy.
   * @param poolTokenIn_ the address of the YEarnV2 vault token to exit
   * @param tokenOutAmount_ amount of tokenOut
   * @param config_ config
   * @return poolTokenInAmount amount of vaultTokenIn_
   * @return executeUniLikeFrom always USDC
   */
  function getExecuteDataByAmountOut(
    address poolTokenIn_,
    uint256 tokenOutAmount_,
    bytes memory config_
  )
    external
    view
    override
    returns (
      uint256 poolTokenInAmount,
      address executeUniLikeFrom,
      bytes memory executeData,
      address executeContract
    )
  {
    poolTokenInAmount = estimateIn(poolTokenIn_, tokenOutAmount_, config_);
    executeData = _getExecuteDataByAmountIn(poolTokenIn_, poolTokenInAmount);
    executeContract = address(zap);
  }

  /**
   * @notice Executes the strategy.
   * @dev Does not use the config argument.
   * @param poolTokenIn_ the address of the YEarnV2 vault token to exit
   * @param poolTokenInAmount_ amount of tokenOut
   * @param config_ config
   * @return executeUniLikeFrom always USDC
   */
  function getExecuteDataByAmountIn(
    address poolTokenIn_,
    uint256 poolTokenInAmount_,
    bytes memory config_
  )
    external
    view
    override
    returns (
      address executeUniLikeFrom,
      bytes memory executeData,
      address executeContract
    )
  {
    executeData = _getExecuteDataByAmountIn(poolTokenIn_, poolTokenInAmount_);
    executeContract = address(zap);
  }

  function _getExecuteDataByAmountIn(address poolTokenIn_, uint256 poolTokenInAmount_)
    internal
    view
    returns (bytes memory)
  {
    return
      abi.encodePacked(
        IIndiciesSupplyRedeemZap(0).depositPoolToken.selector,
        abi.encode(poolTokenIn_, tokenOut, poolTokenInAmount_)
      );
  }

  /**
   * @notice Estimates required amountIn in vault tokens to exit for cvpAmountOut
   * @dev Does not use the config argument
   * @param poolTokenIn_ the address of the pool token to exit
   * @param tokenOutAmount_ the amount of tokenOut
   * @return amountIn in vault tokens
   */
  function estimateIn(
    address poolTokenIn_,
    uint256 tokenOutAmount_,
    bytes memory
  ) public view override returns (uint256) {
    // Assume that the USDC out price is roughly equal to the virtual price
    IErc20VaultPoolSwap vaultSwap = IErc20VaultPoolSwap(zap.poolSwapContract(poolTokenIn_));
    return vaultSwap.calcVaultPoolOutByUsdc(poolTokenIn_, tokenOutAmount_, true).mul(extraOutPct) / 1 ether;
  }

  function estimateOut(
    address poolTokenIn_,
    uint256 tokenInAmount_,
    bytes memory
  ) public view override returns (uint256) {
    // Assume that the USDC out price is roughly equal to the virtual price
    IErc20VaultPoolSwap vaultSwap = IErc20VaultPoolSwap(zap.poolSwapContract(poolTokenIn_));
    return vaultSwap.calcUsdcOutByPool(poolTokenIn_, tokenInAmount_, true).mul(1 ether) / extraOutPct;
  }

  function getTokenOut() external view override returns (address) {
    return tokenOut;
  }
}
