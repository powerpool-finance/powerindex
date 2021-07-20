// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../../interfaces/ICVPMakerStrategy.sol";
import "../../interfaces/IYearnVaultV2.sol";
import "../../interfaces/ICVPMakerViewer.sol";
import "../../interfaces/IErc20VaultPoolSwap.sol";

/**
 * @notice Unwraps YearnVaultV2 tokens into USDC, then swaps it to CVP using Uniswap strategy,
 */
contract CVPMakerVaultStrategy is ICVPMakerStrategy {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  address public immutable tokenOut;
  IErc20VaultPoolSwap public immutable vaultSwap;
  // 100% == 1 ether; for ex. for 1% extra usdc to unwrap set to 1.01 ether
  uint256 public immutable extraOutPct;

  constructor(
    address tokenOut_,
    address vaultSwap_,
    uint256 extraOutPct_
  ) public {
    tokenOut = tokenOut_;
    vaultSwap = IErc20VaultPoolSwap(vaultSwap_);
    extraOutPct = extraOutPct_;
  }

  /**
   * @notice Executes the strategy.
   * @param vaultTokenIn_ the address of the YEarnV2 vault token to exit
   * @param tokenOutAmount_ amount of tokenOut
   * @param config_ config
   * @return vaultInAmount amount of vaultTokenIn_
   * @return executeUniLikeFrom always USDC
   */
  function getExecuteDataByAmountOut(
    address vaultTokenIn_,
    uint256 tokenOutAmount_,
    bytes memory config_
  )
    external
    view
    override
    returns (
      uint256 vaultInAmount,
      address executeUniLikeFrom,
      bytes memory executeData,
      address executeContract
    )
  {
    vaultInAmount = estimateIn(vaultTokenIn_, tokenOutAmount_, config_);
    executeUniLikeFrom = tokenOut;
    executeData = _getExecuteDataByAmountIn(vaultTokenIn_, vaultInAmount);
    executeContract = address(vaultSwap);
  }

  /**
   * @notice Executes the strategy.
   * @dev Does not use the config argument.
   * @param vaultTokenIn_ the address of the YEarnV2 vault token to exit
   * @param tokenInAmount_ amount of tokenOut
   * @param config_ config
   * @return executeUniLikeFrom always USDC
   */
  function getExecuteDataByAmountIn(
    address vaultTokenIn_,
    uint256 tokenInAmount_,
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
    executeUniLikeFrom = tokenOut;
    executeData = _getExecuteDataByAmountIn(vaultTokenIn_, tokenInAmount_);
    executeContract = address(vaultSwap);
  }

  function _getExecuteDataByAmountIn(address vaultTokenIn_, uint256 vaultTokenInAmount_)
    internal
    view
    returns (bytes memory)
  {
    return
      abi.encodePacked(
        IErc20VaultPoolSwap(0).swapVaultToUSDC.selector,
        abi.encode(msg.sender, msg.sender, vaultTokenIn_, vaultTokenInAmount_)
      );
  }

  /**
   * @notice Estimates required amountIn in vault tokens to exit for cvpAmountOut
   * @dev Does not use the config argument
   * @param vaultTokenIn_ the address of the YEarnV2 vault token to exit
   * @param tokenOutAmount_ the amount of tokenOut
   * @return amountIn in vault tokens
   */
  function estimateIn(
    address vaultTokenIn_,
    uint256 tokenOutAmount_,
    bytes memory
  ) public view override returns (uint256) {
    // Assume that the USDC out price is roughly equal to the virtual price
    return vaultSwap.calcVaultOutByUsdc(vaultTokenIn_, tokenOutAmount_).mul(extraOutPct) / 1 ether;
  }

  function estimateOut(
    address vaultTokenIn_,
    uint256 tokenInAmount_,
    bytes memory
  ) public view override returns (uint256) {
    // Assume that the USDC out price is roughly equal to the virtual price
    return vaultSwap.calcUsdcOutByVault(vaultTokenIn_, tokenInAmount_).mul(1 ether) / extraOutPct;
  }

  function getTokenOut() external view override returns (address) {
    return tokenOut;
  }
}
