// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@powerpool/power-oracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interfaces/PowerIndexPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./interfaces/ICurveDepositor.sol";
import "./interfaces/ICurveDepositor2.sol";
import "./interfaces/ICurveDepositor3.sol";
import "./interfaces/ICurveDepositor4.sol";
import "./interfaces/ICurveZapDepositor.sol";
import "./interfaces/ICurveZapDepositor2.sol";
import "./interfaces/ICurveZapDepositor3.sol";
import "./interfaces/ICurveZapDepositor4.sol";
import "./interfaces/IVault.sol";
import "./interfaces/ICurvePoolRegistry.sol";
import "./interfaces/IErc20PiptSwap.sol";
import "./interfaces/IErc20VaultPoolSwap.sol";
import "./traits/ProgressiveFee.sol";

contract Erc20VaultPoolSwap is ProgressiveFee, IErc20VaultPoolSwap {
  using SafeERC20 for IERC20;

  event TakeFee(address indexed pool, address indexed token, uint256 amount);

  event SetVaultConfig(
    address indexed token,
    address depositor,
    uint8 depositorAmountLength,
    uint8 depositorIndex,
    address lpToken,
    address indexed vaultRegistry
  );

  event Erc20ToVaultPoolSwap(address indexed user, address indexed pool, uint256 usdcInAmount, uint256 poolOutAmount);
  event VaultPoolToErc20Swap(address indexed user, address indexed pool, uint256 poolInAmount, uint256 usdcOutAmount);
  event VaultToUsdcSwap(
    address indexed user,
    address indexed from,
    address to,
    address indexed vaultInToken,
    uint256 vaultInAmount,
    uint256 usdcOutAmount
  );
  event ClaimFee(address indexed token, address indexed payout, uint256 amount);

  IERC20 public immutable usdc;

  mapping(address => address[]) public poolTokens;

  struct VaultConfig {
    uint8 depositorLength;
    uint8 depositorIndex;
    uint8 depositorType;
    address depositor;
    address lpToken;
    address curvePoolRegistry;
  }
  mapping(address => VaultConfig) public vaultConfig;

  struct VaultCalc {
    address token;
    uint256 tokenBalance;
    uint256 input;
    uint256 correctInput;
    uint256 poolAmountOut;
  }

  constructor(address _usdc) public {
    __Ownable_init();
    usdc = IERC20(_usdc);
  }

  function setVaultConfigs(
    address[] memory _tokens,
    address[] memory _depositors,
    uint8[] memory _depositorTypes,
    uint8[] memory _depositorAmountLength,
    uint8[] memory _depositorIndexes,
    address[] memory _lpTokens,
    address[] memory _curvePoolRegistries
  ) external onlyOwner {
    uint256 len = _tokens.length;
    require(
      len == _depositors.length &&
        len == _depositorAmountLength.length &&
        len == _depositorIndexes.length &&
        len == _depositorTypes.length &&
        len == _lpTokens.length &&
        len == _curvePoolRegistries.length,
      "L"
    );
    for (uint256 i = 0; i < len; i++) {
      vaultConfig[_tokens[i]] = VaultConfig(
        _depositorAmountLength[i],
        _depositorIndexes[i],
        _depositorTypes[i],
        _depositors[i],
        _lpTokens[i],
        _curvePoolRegistries[i]
      );

      usdc.approve(_depositors[i], uint256(-1));
      IERC20(_lpTokens[i]).approve(_tokens[i], uint256(-1));
      IERC20(_lpTokens[i]).approve(_depositors[i], uint256(-1));
      emit SetVaultConfig(
        _tokens[i],
        _depositors[i],
        _depositorAmountLength[i],
        _depositorIndexes[i],
        _lpTokens[i],
        _curvePoolRegistries[i]
      );
    }
  }

  function updatePools(address[] memory _pools) external onlyOwner {
    uint256 len = _pools.length;
    for (uint256 i = 0; i < len; i++) {
      _updatePool(_pools[i]);
    }
  }

  function claimFee(address[] memory _tokens) external onlyOwner {
    require(feePayout != address(0), "FP_NOT_SET");

    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      uint256 amount = IERC20(_tokens[i]).balanceOf(address(this));
      IERC20(_tokens[i]).safeTransfer(feePayout, amount);
      emit ClaimFee(_tokens[i], feePayout, amount);
    }
  }

  function swapErc20ToVaultPool(
    address _pool,
    address _swapToken,
    uint256 _swapAmount
  ) external override returns (uint256 poolAmountOut) {
    require(_swapToken == address(usdc), "ONLY_USDC");
    usdc.safeTransferFrom(msg.sender, address(this), _swapAmount);

    (, uint256 _swapAmountWithFee) = calcFee(_swapAmount, 0);

    uint256[] memory tokensInPipt;
    (poolAmountOut, tokensInPipt) = _depositVaultAndGetTokensInPipt(_pool, _swapAmountWithFee);

    PowerIndexPoolInterface(_pool).joinPool(poolAmountOut, tokensInPipt);
    (, uint256 communityFee, , ) = PowerIndexPoolInterface(_pool).getCommunityFee();
    poolAmountOut = poolAmountOut.sub(poolAmountOut.mul(communityFee).div(1 ether)) - 1;

    IERC20(_pool).safeTransfer(msg.sender, poolAmountOut);

    emit Erc20ToVaultPoolSwap(msg.sender, _pool, _swapAmount, poolAmountOut);
  }

  function swapVaultPoolToErc20(
    address _pool,
    uint256 _poolAmountIn,
    address _swapToken
  ) external override returns (uint256 erc20Out) {
    require(_swapToken == address(usdc), "ONLY_USDC");
    IERC20(_pool).safeTransferFrom(msg.sender, address(this), _poolAmountIn);

    (, uint256 _poolAmountInWithFee) = calcFee(_poolAmountIn, 0);

    erc20Out = _redeemPooledVault(_pool, _poolAmountInWithFee);

    usdc.safeTransfer(msg.sender, erc20Out);

    emit VaultPoolToErc20Swap(msg.sender, _pool, _poolAmountIn, erc20Out);
  }

  function swapVaultToUSDC(
    address _from,
    address _to,
    address _vaultTokenIn,
    uint256 _vaultAmountIn
  ) external override returns (uint256 usdcAmountOut) {
    IERC20(_vaultTokenIn).safeTransferFrom(_from, address(this), _vaultAmountIn);
    usdcAmountOut = _redeemVault(_vaultTokenIn, _vaultAmountIn);
    usdc.safeTransfer(_to, usdcAmountOut);

    emit VaultToUsdcSwap(msg.sender, _from, _to, _vaultTokenIn, _vaultAmountIn, usdcAmountOut);
  }

  /* ==========  View Functions  ========== */

  function calcVaultOutByUsdc(address _token, uint256 _usdcIn) public view override returns (uint256 amountOut) {
    VaultConfig storage vc = vaultConfig[_token];
    uint256 vaultByLpPrice = IVault(_token).pricePerShare();
    return calcDepositorTokenAmount(vc, _usdcIn, true).mul(1e30).div(vaultByLpPrice);
  }

  function calcDepositorTokenAmount(
    VaultConfig storage vc,
    uint256 _amount,
    bool _isDeposit
  ) internal view returns (uint256) {
    if (vc.depositorLength == 2) {
      uint256[2] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      if (vc.depositorType == 2) {
        return ICurveZapDepositor2(vc.depositor).calc_token_amount(vc.lpToken, amounts, _isDeposit);
      } else {
        return ICurveDepositor2(vc.depositor).calc_token_amount(amounts, _isDeposit);
      }
    }

    if (vc.depositorLength == 3) {
      uint256[3] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      if (vc.depositorType == 2) {
        return ICurveZapDepositor3(vc.depositor).calc_token_amount(vc.lpToken, amounts, _isDeposit);
      } else {
        return ICurveDepositor3(vc.depositor).calc_token_amount(amounts, _isDeposit);
      }
    }

    if (vc.depositorLength == 4) {
      uint256[4] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      if (vc.depositorType == 2) {
        return ICurveZapDepositor4(vc.depositor).calc_token_amount(vc.lpToken, amounts, _isDeposit);
      } else {
        return ICurveDepositor4(vc.depositor).calc_token_amount(amounts, _isDeposit);
      }
    }
    return 0;
  }

  function calcVaultPoolOutByUsdc(
    address _pool,
    uint256 _usdcIn,
    bool _withFee
  ) external view override returns (uint256 amountOut) {
    uint256 len = poolTokens[_pool].length;
    PowerIndexPoolInterface p = PowerIndexPoolInterface(_pool);
    uint256 piptTotalSupply = p.totalSupply();

    (VaultCalc[] memory vc, uint256 restInput, uint256 totalCorrectInput) =
      getVaultCalcsForSupply(_pool, piptTotalSupply, _usdcIn);

    uint256[] memory tokensInPipt = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      uint256 share = vc[i].correctInput.mul(1 ether).div(totalCorrectInput);
      vc[i].correctInput = vc[i].correctInput.add(restInput.mul(share).div(1 ether)).sub(100);

      tokensInPipt[i] = calcVaultOutByUsdc(vc[i].token, vc[i].correctInput);

      uint256 poolOutByToken = tokensInPipt[i].sub(1e12).mul(piptTotalSupply).div(vc[i].tokenBalance);
      if (poolOutByToken < amountOut || amountOut == 0) {
        amountOut = poolOutByToken;
      }
    }
    if (_withFee) {
      (, uint256 communityJoinFee, , ) = p.getCommunityFee();
      (amountOut, ) = p.calcAmountWithCommunityFee(amountOut, communityJoinFee, address(this));
    }
  }

  function calcUsdcOutByVault(address _vaultTokenIn, uint256 _vaultAmountIn)
    public
    view
    override
    returns (uint256 usdcAmountOut)
  {
    VaultConfig storage vc = vaultConfig[_vaultTokenIn];
    uint256 lpByUsdcPrice = ICurvePoolRegistry(vc.curvePoolRegistry).get_virtual_price_from_lp_token(vc.lpToken);
    uint256 vaultByLpPrice = IVault(_vaultTokenIn).pricePerShare();
    return _vaultAmountIn.mul(vaultByLpPrice.mul(lpByUsdcPrice).div(1 ether)).div(1e30);
  }

  function calcUsdcOutByPool(
    address _pool,
    uint256 _ppolIn,
    bool _withFee
  ) external view override returns (uint256 amountOut) {
    uint256 len = poolTokens[_pool].length;
    PowerIndexPoolInterface p = PowerIndexPoolInterface(_pool);

    if (_withFee) {
      (, , uint256 communityExitFee, ) = p.getCommunityFee();
      (_ppolIn, ) = p.calcAmountWithCommunityFee(_ppolIn, communityExitFee, address(this));
    }

    uint256 ratio = _ppolIn.mul(1 ether).div(p.totalSupply());

    for (uint256 i = 0; i < len; i++) {
      address t = poolTokens[_pool][i];
      uint256 bal = p.getBalance(t);
      amountOut = amountOut.add(calcUsdcOutByVault(t, ratio.mul(bal).div(1 ether)));
    }
  }

  function getVaultCalcsForSupply(
    address _pool,
    uint256 piptTotalSupply,
    uint256 totalInputAmount
  )
    public
    view
    returns (
      VaultCalc[] memory vc,
      uint256 restInput,
      uint256 totalCorrectInput
    )
  {
    uint256 len = poolTokens[_pool].length;
    vc = new VaultCalc[](len);

    uint256 minPoolAmount;
    for (uint256 i = 0; i < len; i++) {
      vc[i].token = poolTokens[_pool][i];
      vc[i].tokenBalance = PowerIndexPoolInterface(_pool).getBalance(vc[i].token);
      vc[i].input = totalInputAmount / len;
      vc[i].poolAmountOut = calcVaultOutByUsdc(vc[i].token, vc[i].input).mul(piptTotalSupply).div(vc[i].tokenBalance);
      if (minPoolAmount == 0 || vc[i].poolAmountOut < minPoolAmount) {
        minPoolAmount = vc[i].poolAmountOut;
      }
    }

    for (uint256 i = 0; i < len; i++) {
      if (vc[i].poolAmountOut > minPoolAmount) {
        uint256 ratio = minPoolAmount.mul(1 ether).div(vc[i].poolAmountOut);
        vc[i].correctInput = ratio.mul(vc[i].input).div(1 ether);
        restInput = restInput.add(vc[i].input.sub(vc[i].correctInput));
      } else {
        vc[i].correctInput = vc[i].input;
      }
    }

    totalCorrectInput = totalInputAmount.sub(restInput).sub(100);
  }

  /* ==========  Internal Functions  ========== */

  function _depositVaultAndGetTokensInPipt(address _pool, uint256 _totalInputAmount)
    internal
    returns (uint256 poolAmountOut, uint256[] memory tokensInPipt)
  {
    require(_totalInputAmount != 0, "NULL_INPUT");
    uint256 len = poolTokens[_pool].length;
    uint256 piptTotalSupply = PowerIndexPoolInterface(_pool).totalSupply();

    (VaultCalc[] memory vc, uint256 restInput, uint256 totalCorrectInput) =
      getVaultCalcsForSupply(_pool, piptTotalSupply, _totalInputAmount);

    tokensInPipt = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      uint256 share = vc[i].correctInput.mul(1 ether).div(totalCorrectInput);
      vc[i].correctInput = vc[i].correctInput.add(restInput.mul(share).div(1 ether)).sub(100);

      uint256 balanceBefore = IVault(vc[i].token).balanceOf(address(this));
      IVault(vc[i].token).deposit(_addYearnLpTokenLiquidity(vaultConfig[vc[i].token], vc[i].correctInput));
      tokensInPipt[i] = IVault(vc[i].token).balanceOf(address(this)).sub(balanceBefore);

      uint256 poolOutByToken = tokensInPipt[i].sub(1e12).mul(piptTotalSupply).div(vc[i].tokenBalance);
      if (poolOutByToken < poolAmountOut || poolAmountOut == 0) {
        poolAmountOut = poolOutByToken;
      }
    }
    require(poolAmountOut != 0, "NULL_OUTPUT");
  }

  function _addYearnLpTokenLiquidity(VaultConfig storage vc, uint256 _amount) internal returns (uint256) {
    uint256 balanceBefore = IERC20(vc.lpToken).balanceOf(address(this));
    if (vc.depositorLength == 2) {
      uint256[2] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      if (vc.depositorType == 2) {
        ICurveZapDepositor2(vc.depositor).add_liquidity(vc.lpToken, amounts, 1);
      } else {
        ICurveDepositor2(vc.depositor).add_liquidity(amounts, 1);
      }
    }

    if (vc.depositorLength == 3) {
      uint256[3] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      if (vc.depositorType == 2) {
        ICurveZapDepositor3(vc.depositor).add_liquidity(vc.lpToken, amounts, 1);
      } else {
        ICurveDepositor3(vc.depositor).add_liquidity(amounts, 1);
      }
    }

    if (vc.depositorLength == 4) {
      uint256[4] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      if (vc.depositorType == 2) {
        ICurveZapDepositor4(vc.depositor).add_liquidity(vc.lpToken, amounts, 1);
      } else {
        ICurveDepositor4(vc.depositor).add_liquidity(amounts, 1);
      }
    }
    uint256 balanceAfter = IERC20(vc.lpToken).balanceOf(address(this));
    return balanceAfter.sub(balanceBefore);
  }

  function _redeemPooledVault(address _pool, uint256 _totalInputAmount) internal returns (uint256 totalOutputAmount) {
    require(_totalInputAmount != 0, "NULL_INPUT");
    address[] memory tokens = poolTokens[_pool];
    uint256 len = tokens.length;

    uint256[] memory amounts = new uint256[](len);
    uint256[] memory prevBalances = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      prevBalances[i] = IERC20(tokens[i]).balanceOf(address(this));
    }
    PowerIndexPoolInterface(_pool).exitPool(_totalInputAmount, amounts);
    for (uint256 i = 0; i < len; i++) {
      amounts[i] = IERC20(tokens[i]).balanceOf(address(this)).sub(prevBalances[i]);
    }

    uint256 outputTokenBalanceBefore = usdc.balanceOf(address(this));
    for (uint256 i = 0; i < len; i++) {
      VaultConfig storage vc = vaultConfig[tokens[i]];
      uint256 lpTokenBalanceBefore = IERC20(vc.lpToken).balanceOf(address(this));
      IVault(tokens[i]).withdraw(amounts[i]);
      uint256 lpTokenAmount = IERC20(vc.lpToken).balanceOf(address(this)).sub(lpTokenBalanceBefore);
      if (vc.depositorType == 2) {
        ICurveZapDepositor(vc.depositor).remove_liquidity_one_coin(
          vc.lpToken,
          lpTokenAmount,
          int8(vc.depositorIndex),
          1
        );
      } else {
        ICurveDepositor(vc.depositor).remove_liquidity_one_coin(lpTokenAmount, int8(vc.depositorIndex), 1);
      }
    }
    totalOutputAmount = usdc.balanceOf(address(this)).sub(outputTokenBalanceBefore);
    require(totalOutputAmount != 0, "NULL_OUTPUT");
  }

  function _redeemVault(address _vault, uint256 _amountIn) internal returns (uint256 amountOut) {
    uint256 usdcBefore = usdc.balanceOf(address(this));

    VaultConfig storage vc = vaultConfig[_vault];
    uint256 lpTokenBalanceBefore = IERC20(vc.lpToken).balanceOf(address(this));
    IVault(_vault).withdraw(_amountIn);
    if (vc.depositorType == 2) {
      ICurveZapDepositor(vc.depositor).remove_liquidity_one_coin(
        vc.lpToken,
        IERC20(vc.lpToken).balanceOf(address(this)).sub(lpTokenBalanceBefore),
        int128(vc.depositorIndex),
        1
      );
    } else {
      ICurveDepositor(vc.depositor).remove_liquidity_one_coin(
        IERC20(vc.lpToken).balanceOf(address(this)).sub(lpTokenBalanceBefore),
        int128(vc.depositorIndex),
        1
      );
    }

    amountOut = usdc.balanceOf(address(this)).sub(usdcBefore);
    require(amountOut != 0, "NULL_OUTPUT");
  }

  function _updatePool(address _pool) internal {
    poolTokens[_pool] = PowerIndexPoolInterface(_pool).getCurrentTokens();
    uint256 len = poolTokens[_pool].length;
    for (uint256 i = 0; i < len; i++) {
      IERC20(poolTokens[_pool][i]).approve(_pool, uint256(-1));
    }
  }
}
