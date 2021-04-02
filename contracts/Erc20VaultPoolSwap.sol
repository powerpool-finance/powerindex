// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@powerpool/poweroracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interfaces/PowerIndexPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./interfaces/IVaultDepositor2.sol";
import "./interfaces/IVaultDepositor3.sol";
import "./interfaces/IVaultDepositor4.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IVaultRegistry.sol";
import "./interfaces/IErc20PiptSwap.sol";
import "./interfaces/IErc20VaultPoolSwap.sol";
import "./traits/ProgressiveFee.sol";

contract Erc20VaultPoolSwap is ProgressiveFee, IErc20VaultPoolSwap {
  using SafeERC20 for IERC20;

  event TakeFee(address indexed pool, address indexed token, uint256 amount);
  event ClaimFee(address indexed token, uint256 amount);

  event SetVaultConfig(
    address indexed token,
    address depositor,
    uint256 depositorAmountLength,
    uint256 depositorIndex,
    address lpToken,
    address indexed vaultRegistry
  );

  event Erc20ToVaultPoolSwap(address indexed user, address indexed pool, uint256 usdcInAmount, uint256 poolOutAmount);
  event VaultPoolToErc20Swap(address indexed user, address indexed pool, uint256 poolInAmount, uint256 usdcOutAmount);

  IERC20 public immutable usdc;

  mapping(address => address[]) public poolTokens;

  struct VaultConfig {
    uint256 depositorLength;
    uint256 depositorIndex;
    address depositor;
    address lpToken;
    address vaultRegistry;
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
    uint256[] memory _depositorAmountLength,
    uint256[] memory _depositorIndexes,
    address[] memory _lpTokens,
    address[] memory _vaultRegistries
  ) external onlyOwner {
    uint256 len = _tokens.length;
    require(
      len == _depositors.length &&
        len == _depositorAmountLength.length &&
        len == _depositorIndexes.length &&
        len == _lpTokens.length &&
        len == _vaultRegistries.length,
      "L"
    );
    for (uint256 i = 0; i < len; i++) {
      vaultConfig[_tokens[i]] = VaultConfig(
        _depositorAmountLength[i],
        _depositorIndexes[i],
        _depositors[i],
        _lpTokens[i],
        _vaultRegistries[i]
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
        _vaultRegistries[i]
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
    require(feePayout != address(0), "FR_NOT_SET");

    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      IERC20(_tokens[i]).safeTransfer(feePayout, IERC20(_tokens[i]).balanceOf(address(this)));
    }
  }

  function swapErc20cToVaultPool(
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

    erc20Out = _redeemVault(_pool, _poolAmountInWithFee);

    usdc.safeTransfer(msg.sender, erc20Out);

    emit VaultPoolToErc20Swap(msg.sender, _pool, _poolAmountIn, erc20Out);
  }

  /* ==========  View Functions  ========== */

  function calcVaultOutByUsdc(address _token, uint256 _usdcIn) public view returns (uint256 amountOut) {
    VaultConfig storage vc = vaultConfig[_token];
    uint256 lpByUsdcPrice = IVaultRegistry(vc.vaultRegistry).get_virtual_price_from_lp_token(vc.lpToken);
    uint256 vaultByLpPrice = IVault(_token).getPricePerFullShare();
    return _usdcIn.mul(1e30).div(vaultByLpPrice.mul(lpByUsdcPrice).div(1 ether));
  }

  function calcVaultPoolOutByUsdc(address _pool, uint256 _usdcIn) external view returns (uint256 amountOut) {
    uint256 len = poolTokens[_pool].length;
    uint256 piptTotalSupply = PowerIndexPoolInterface(_pool).totalSupply();

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
  }

  function calcUsdcOutByVault(address _token, uint256 _vaultIn) public view returns (uint256 amountOut) {
    VaultConfig storage vc = vaultConfig[_token];
    uint256 lpByUsdcPrice = IVaultRegistry(vc.vaultRegistry).get_virtual_price_from_lp_token(vc.lpToken);
    uint256 vaultByLpPrice = IVault(_token).getPricePerFullShare();
    return _vaultIn.mul(vaultByLpPrice.mul(lpByUsdcPrice).div(1 ether)).div(1e30);
  }

  function calcUsdcOutByPool(address _pool, uint256 _ppolIn) external view returns (uint256 amountOut) {
    uint256 len = poolTokens[_pool].length;
    uint256 ratio = _ppolIn.mul(1 ether).div(PowerIndexPoolInterface(_pool).totalSupply());

    for (uint256 i = 0; i < len; i++) {
      address t = poolTokens[_pool][i];
      uint256 bal = PowerIndexPoolInterface(_pool).getBalance(t);
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

  function _depositVaultAndGetTokensInPipt(address _pool, uint256 totalInputAmount)
    internal
    returns (uint256 poolAmountOut, uint256[] memory tokensInPipt)
  {
    uint256 len = poolTokens[_pool].length;
    uint256 piptTotalSupply = PowerIndexPoolInterface(_pool).totalSupply();

    (VaultCalc[] memory vc, uint256 restInput, uint256 totalCorrectInput) =
      getVaultCalcsForSupply(_pool, piptTotalSupply, totalInputAmount);

    tokensInPipt = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      uint256 share = vc[i].correctInput.mul(1 ether).div(totalCorrectInput);
      vc[i].correctInput = vc[i].correctInput.add(restInput.mul(share).div(1 ether)).sub(100);

      IVault(vc[i].token).deposit(_addYearnLpTokenLiquidity(vaultConfig[vc[i].token], vc[i].correctInput));
      tokensInPipt[i] = IVault(vc[i].token).balanceOf(address(this));

      uint256 poolOutByToken = tokensInPipt[i].sub(1e12).mul(piptTotalSupply).div(vc[i].tokenBalance);
      if (poolOutByToken < poolAmountOut || poolAmountOut == 0) {
        poolAmountOut = poolOutByToken;
      }
    }
  }

  function _addYearnLpTokenLiquidity(VaultConfig storage vc, uint256 _amount) internal returns (uint256) {
    if (vc.depositorLength == 2) {
      uint256[2] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      IVaultDepositor2(vc.depositor).add_liquidity(amounts, 1);
    }

    if (vc.depositorLength == 3) {
      uint256[3] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      IVaultDepositor3(vc.depositor).add_liquidity(amounts, 1);
    }

    if (vc.depositorLength == 4) {
      uint256[4] memory amounts;
      amounts[vc.depositorIndex] = _amount;
      IVaultDepositor4(vc.depositor).add_liquidity(amounts, 1);
    }
    return IERC20(vc.lpToken).balanceOf(address(this));
  }

  function _redeemVault(address _pool, uint256 totalInputAmount) internal returns (uint256 totalOutputAmount) {
    address[] memory tokens = poolTokens[_pool];
    uint256 len = tokens.length;

    uint256[] memory amounts = new uint256[](len);
    PowerIndexPoolInterface(_pool).exitPool(totalInputAmount, amounts);

    uint256 outputTokenBalanceBefore = usdc.balanceOf(address(this));
    for (uint256 i = 0; i < len; i++) {
      VaultConfig storage vc = vaultConfig[tokens[i]];
      IVault(tokens[i]).withdraw(IERC20(tokens[i]).balanceOf(address(this)));
      IVaultDepositor2(vc.depositor).remove_liquidity_one_coin(
        IERC20(vc.lpToken).balanceOf(address(this)),
        int128(vc.depositorIndex),
        1
      );
    }
    totalOutputAmount = usdc.balanceOf(address(this)).sub(outputTokenBalanceBefore);
  }

  function _updatePool(address _pool) internal {
    poolTokens[_pool] = PowerIndexPoolInterface(_pool).getCurrentTokens();
    uint256 len = poolTokens[_pool].length;
    for (uint256 i = 0; i < len; i++) {
      IERC20(poolTokens[_pool][i]).approve(_pool, uint256(-1));
    }
  }
}
