// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@powerpool/poweroracle/contracts/interfaces/IPowerPoke.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interfaces/PowerIndexPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./Erc20PiptSwap.sol";
import "./interfaces/IVaultDepositor2.sol";
import "./interfaces/IVaultDepositor3.sol";
import "./interfaces/IVaultDepositor4.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IVaultRegistry.sol";

contract IndicesSupplyRedeemZap is OwnableUpgradeSafe {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  event InitRound(
    bytes32 indexed key,
    address indexed pool,
    uint256 endTime,
    address indexed inputToken,
    address outputToken
  );
  event FinishRound(
    bytes32 indexed key,
    address indexed pool,
    address indexed inputToken,
    uint256 totalInputAmount,
    uint256 inputCap,
    uint256 initEndTime,
    uint256 finishEndTime
  );

  event SetFee(address indexed token, uint256 fee);
  event SetFeeReceiver(address indexed feeReceiver);
  event TakeFee(address indexed pool, address indexed token, uint256 amount);
  event ClaimFee(address indexed token, uint256 amount);

  event SetRoundPeriod(uint256 roundPeriod);
  event SetPool(address indexed pool, PoolType pType);
  event SetPiptSwap(address indexed pool, address piptSwap);
  event SetTokenCap(address indexed token, uint256 cap);
  event SetVaultConfig(
    address indexed token,
    address depositor,
    uint256 depositorAmountLength,
    uint256 depositorIndex,
    address lpToken,
    address indexed vaultRegistry
  );

  event Deposit(
    bytes32 indexed roundKey,
    address indexed pool,
    address indexed user,
    address inputToken,
    uint256 inputAmount
  );
  event Withdraw(
    bytes32 indexed roundKey,
    address indexed pool,
    address indexed user,
    address inputToken,
    uint256 inputAmount
  );

  event SupplyAndRedeemPoke(
    bytes32 indexed roundKey,
    address indexed pool,
    address indexed inputToken,
    address outputToken,
    uint256 totalInputAmount,
    uint256 totalOutputAmount
  );
  event ClaimPoke(
    bytes32 indexed roundKey,
    address indexed pool,
    address indexed claimFor,
    address inputToken,
    address outputToken,
    uint256 inputAmount,
    uint256 outputAmount
  );

  uint256 internal constant COMPENSATION_PLAN_1_ID = 1;
  address public constant ETH = 0x0000000000000000000000000000000000000001;

  IERC20 public immutable usdc;
  IPowerPoke public immutable powerPoke;

  enum PoolType { NULL, PIPT, VAULT }

  mapping(address => PoolType) public poolType;
  mapping(address => address) public poolPiptSwap;
  mapping(address => uint256) public tokenCap;
  mapping(address => address[]) public poolTokens;

  struct VaultConfig {
    uint256 depositorLength;
    uint256 depositorIndex;
    address depositor;
    address lpToken;
    address vaultRegistry;
  }
  mapping(address => VaultConfig) public vaultConfig;

  uint256 public roundPeriod;

  uint256 public oddEth;

  address public feeReceiver;
  mapping(address => uint256) public feeByToken;
  mapping(address => uint256) public pendingFeeByToken;

  mapping(address => uint256) public pendingOddTokens;

  struct Round {
    uint256 blockNumber;
    address inputToken;
    address outputToken;
    address pool;
    mapping(address => uint256) inputAmount;
    uint256 totalInputAmount;
    mapping(address => uint256) outputAmount;
    uint256 totalOutputAmount;
    uint256 totalOutputAmountClaimed;
    uint256 endTime;
  }
  mapping(bytes32 => Round) public rounds;

  mapping(bytes32 => bytes32) public lastRoundByPartialKey;

  struct VaultCalc {
    address token;
    uint256 tokenBalance;
    uint256 input;
    uint256 correctInput;
    uint256 out;
    uint256 correctOut;
    uint256 poolAmountOut;
  }

  modifier onlyReporter(uint256 _reporterId, bytes calldata _rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeReporter(_reporterId, msg.sender);
    _;
    _reward(_reporterId, gasStart, COMPENSATION_PLAN_1_ID, _rewardOpts);
  }

  modifier onlyNonReporter(uint256 _reporterId, bytes calldata _rewardOpts) {
    uint256 gasStart = gasleft();
    powerPoke.authorizeNonReporter(_reporterId, msg.sender);
    _;
    _reward(_reporterId, gasStart, COMPENSATION_PLAN_1_ID, _rewardOpts);
  }

  modifier onlyEOA() {
    require(tx.origin == msg.sender, "ONLY_EOA");
    _;
  }

  constructor(address _usdc, address _powerPoke) public {
    usdc = IERC20(_usdc);
    powerPoke = IPowerPoke(_powerPoke);
  }

  function initialize(uint256 _roundPeriod, address _feeReceiver) external initializer {
    __Ownable_init();
    feeReceiver = _feeReceiver;
    roundPeriod = _roundPeriod;
  }

  receive() external payable {
    pendingOddTokens[ETH] = pendingOddTokens[ETH].add(msg.value);
  }

  /* ==========  Client Functions  ========== */

  function depositEth(address _pool) external payable onlyEOA {
    require(poolType[_pool] == PoolType.PIPT, "NOT_SUPPORTED_POOL");

    _deposit(_pool, ETH, _pool, msg.value);
  }

  function depositErc20(
    address _pool,
    address _inputToken,
    uint256 _amount
  ) external onlyEOA {
    require(poolType[_pool] != PoolType.NULL, "UNKNOWN_POOL");

    require(_inputToken == address(usdc), "NOT_SUPPORTED_TOKEN");

    _deposit(_pool, _inputToken, _pool, _amount);
  }

  function depositPoolToken(
    address _pool,
    address _outputToken,
    uint256 _poolAmount
  ) external onlyEOA {
    PoolType pType = poolType[_pool];
    require(pType != PoolType.NULL, "UNKNOWN_POOL");

    if (pType == PoolType.PIPT) {
      require(_outputToken == address(usdc) || _outputToken == ETH, "NOT_SUPPORTED_TOKEN");
    } else {
      require(_outputToken == address(usdc), "NOT_SUPPORTED_TOKEN");
    }

    _deposit(_pool, _pool, _outputToken, _poolAmount);
  }

  function withdrawEth(address _pool, uint256 _amount) external onlyEOA {
    require(poolType[_pool] == PoolType.PIPT, "NOT_SUPPORTED_POOL");

    _withdraw(_pool, ETH, _pool, _amount);
  }

  function withdrawErc20(
    address _pool,
    address _outputToken,
    uint256 _amount
  ) external onlyEOA {
    require(poolType[_pool] != PoolType.NULL, "UNKNOWN_POOL");
    require(_outputToken != ETH, "ETH_CANT_BE_OUTPUT_TOKEN");

    _withdraw(_pool, _outputToken, _pool, _amount);
  }

  function withdrawPoolToken(
    address _pool,
    address _outputToken,
    uint256 _amount
  ) external onlyEOA {
    PoolType pType = poolType[_pool];
    require(pType != PoolType.NULL, "UNKNOWN_POOL");

    if (pType == PoolType.PIPT) {
      require(_outputToken == address(usdc) || _outputToken == ETH, "NOT_SUPPORTED_TOKEN");
    } else {
      require(_outputToken == address(usdc), "NOT_SUPPORTED_TOKEN");
    }

    _withdraw(_pool, _pool, _outputToken, _amount);
  }

  /* ==========  Poker Functions  ========== */

  function supplyAndRedeemPokeFromReporter(
    uint256 _reporterId,
    bytes32[] memory _roundKeys,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) onlyEOA {
    _supplyAndRedeemPoke(_roundKeys, false);
  }

  function supplyAndRedeemPokeFromSlasher(
    uint256 _reporterId,
    bytes32[] memory _roundKeys,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) onlyEOA {
    _supplyAndRedeemPoke(_roundKeys, true);
  }

  function claimPokeFromReporter(
    uint256 _reporterId,
    bytes32 _roundKey,
    address[] memory _claimForList,
    bytes calldata _rewardOpts
  ) external onlyReporter(_reporterId, _rewardOpts) onlyEOA {
    _claimPoke(_roundKey, _claimForList, false);
  }

  function claimPokeFromSlasher(
    uint256 _reporterId,
    bytes32 _roundKey,
    address[] memory _claimForList,
    bytes calldata _rewardOpts
  ) external onlyNonReporter(_reporterId, _rewardOpts) onlyEOA {
    _claimPoke(_roundKey, _claimForList, true);
  }

  /* ==========  Owner Functions  ========== */

  function setRoundPeriod(uint256 _roundPeriod) external onlyOwner {
    roundPeriod = _roundPeriod;
    emit SetRoundPeriod(roundPeriod);
  }

  function setPools(address[] memory _pools, PoolType[] memory _types) external onlyOwner {
    uint256 len = _pools.length;
    require(len == _types.length, "LENGTH_ERR");
    for (uint256 i = 0; i < len; i++) {
      poolType[_pools[i]] = _types[i];
      _updatePool(_pools[i]);
      emit SetPool(_pools[i], _types[i]);
    }
  }

  function setPoolsPiptSwap(address[] memory _pools, address[] memory _piptSwaps) external onlyOwner {
    uint256 len = _pools.length;
    require(len == _piptSwaps.length, "LENGTH_ERR");
    for (uint256 i = 0; i < len; i++) {
      poolPiptSwap[_pools[i]] = _piptSwaps[i];
      usdc.approve(_piptSwaps[i], uint256(-1));
      IERC20(_pools[i]).approve(_piptSwaps[i], uint256(-1));
      emit SetPiptSwap(_pools[i], _piptSwaps[i]);
    }
  }

  function setTokensCap(address[] memory _tokens, uint256[] memory _caps) external onlyOwner {
    uint256 len = _tokens.length;
    require(len == _caps.length, "LENGTH_ERR");
    for (uint256 i = 0; i < len; i++) {
      tokenCap[_tokens[i]] = _caps[i];
      emit SetTokenCap(_tokens[i], _caps[i]);
    }
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
      "LENGTH_ERR"
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

  function setFee(address[] memory _tokens, uint256[] memory _fees) external onlyOwner {
    uint256 len = _tokens.length;
    require(len == _fees.length, "LENGTH_ERR");
    for (uint256 i = 0; i < len; i++) {
      feeByToken[_tokens[i]] = _fees[i];
      emit SetFee(_tokens[i], _fees[i]);
    }
  }

  function setFeeReceiver(address _feeReceiver) external onlyOwner {
    feeReceiver = _feeReceiver;
    emit SetFeeReceiver(feeReceiver);
  }

  function claimFee(address[] memory _tokens) external onlyOwner {
    require(feeReceiver != address(0), "FEE_RECEIVER_NOT_SET");

    uint256 len = _tokens.length;
    for (uint256 i = 0; i < len; i++) {
      address token = _tokens[i];
      if (token == ETH) {
        payable(feeReceiver).transfer(pendingFeeByToken[token]);
      } else {
        IERC20(token).safeTransfer(feeReceiver, pendingFeeByToken[token]);
      }
      emit ClaimFee(token, pendingFeeByToken[token]);
      pendingFeeByToken[token] = 0;
    }
  }

  /* ==========  View Functions  ========== */

  function getCurrentBlockRoundKey(
    address pool,
    address inputToken,
    address outputToken
  ) public view returns (bytes32) {
    return getRoundKey(block.number, pool, inputToken, outputToken);
  }

  function getRoundKey(
    uint256 blockNumber,
    address pool,
    address inputToken,
    address outputToken
  ) public view returns (bytes32) {
    return keccak256(abi.encodePacked(blockNumber, pool, inputToken, outputToken));
  }

  function getRoundPartialKey(
    address pool,
    address inputToken,
    address outputToken
  ) public view returns (bytes32) {
    return keccak256(abi.encodePacked(pool, inputToken, outputToken));
  }

  function getLastRoundKey(
    address pool,
    address inputToken,
    address outputToken
  ) external view returns (bytes32) {
    return lastRoundByPartialKey[getRoundPartialKey(pool, inputToken, outputToken)];
  }

  function isRoundReadyToExecute(bytes32 roundKey) public view returns (bool) {
    Round storage round = rounds[roundKey];
    if (tokenCap[round.inputToken] == 0) {
      return round.endTime <= block.timestamp;
    }
    return round.totalInputAmount >= tokenCap[round.inputToken] || round.endTime <= block.timestamp;
  }

  function getRoundUserInput(bytes32 roundKey, address user) external view returns (uint256) {
    return rounds[roundKey].inputAmount[user];
  }

  function getRoundUserOutput(bytes32 roundKey, address user) external view returns (uint256) {
    return rounds[roundKey].outputAmount[user];
  }

  function calcVaultOutByUsdc(address _token, uint256 _usdcIn) public view returns (uint256 amountOut) {
    VaultConfig storage vc = vaultConfig[_token];
    uint256 lpByUsdcPrice = IVaultRegistry(vc.vaultRegistry).get_virtual_price_from_lp_token(vc.lpToken);
    uint256 vaultByLpPrice = IVault(_token).getPricePerFullShare();
    return _usdcIn.mul(1e30).div(vaultByLpPrice.mul(lpByUsdcPrice).div(1 ether));
  }

  //TODO: optimize contract for adding external calculation getters
  //  function calcVaultPoolOutByUsdc(address _pool, uint256 _usdcIn) external view returns (uint256 amountOut) {
  //    uint256 len = poolTokens[_pool].length;
  //    uint256 piptTotalSupply = PowerIndexPoolInterface(_pool).totalSupply();
  //
  //    (VaultCalc[] memory vc, uint256 restInput, uint256 totalCorrectInput) =
  //      _getVaultCalsForSupply(_pool, piptTotalSupply, _usdcIn);
  //
  //    uint256[] memory tokensInPipt = new uint256[](len);
  //    for (uint256 i = 0; i < len; i++) {
  //      uint256 share = vc[i].correctInput.mul(1 ether).div(totalCorrectInput);
  //      vc[i].correctInput = vc[i].correctInput.add(restInput.mul(share).div(1 ether)).sub(100);
  //
  //      tokensInPipt[i] = calcVaultOutByUsdc(vc[i].token, vc[i].correctInput);
  //
  //      uint256 poolOutByToken = tokensInPipt[i].sub(1e6).mul(piptTotalSupply).div(vc[i].tokenBalance);
  //      if (poolOutByToken < amountOut || amountOut == 0) {
  //        amountOut = poolOutByToken;
  //      }
  //    }
  //  }

  function calcUsdcOutByVault(address _token, uint256 _vaultIn) external view returns (uint256 amountOut) {
    VaultConfig storage vc = vaultConfig[_token];
    uint256 lpByUsdcPrice = IVaultRegistry(vc.vaultRegistry).get_virtual_price_from_lp_token(vc.lpToken);
    uint256 vaultByLpPrice = IVault(_token).getPricePerFullShare();
    return _vaultIn.mul(vaultByLpPrice.mul(lpByUsdcPrice).div(1 ether)).div(1e6);
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
      vc[i].out = calcVaultOutByUsdc(vc[i].token, vc[i].input);
      vc[i].poolAmountOut = vc[i].out.mul(piptTotalSupply).div(vc[i].tokenBalance);
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

  function _deposit(
    address _pool,
    address _inputToken,
    address _outputToken,
    uint256 _amount
  ) internal {
    require(_amount > 0, "NULL_AMOUNT");
    bytes32 roundKey = _updateRound(_pool, _inputToken, _outputToken);

    if (_inputToken != ETH) {
      IERC20(_inputToken).safeTransferFrom(msg.sender, address(this), _amount);
    }

    Round storage round = rounds[roundKey];
    round.inputAmount[msg.sender] = round.inputAmount[msg.sender].add(_amount);
    round.totalInputAmount = round.totalInputAmount.add(_amount);

    emit Deposit(roundKey, _pool, msg.sender, _inputToken, _amount);
  }

  function _withdraw(
    address _pool,
    address _inputToken,
    address _outputToken,
    uint256 _amount
  ) internal {
    require(_amount > 0, "NULL_AMOUNT");
    bytes32 roundKey = _updateRound(_pool, _inputToken, _outputToken);
    Round storage round = rounds[roundKey];

    round.inputAmount[msg.sender] = round.inputAmount[msg.sender].sub(_amount);
    round.totalInputAmount = round.totalInputAmount.sub(_amount);

    if (_inputToken == ETH) {
      msg.sender.transfer(_amount);
    } else {
      IERC20(_inputToken).safeTransfer(msg.sender, _amount);
    }

    emit Withdraw(roundKey, _pool, msg.sender, _inputToken, _amount);
  }

  function _supplyAndRedeemPoke(bytes32[] memory _roundKeys, bool _bySlasher) internal {
    (uint256 minInterval, uint256 maxInterval) = _getMinMaxReportInterval();

    uint256 len = _roundKeys.length;
    require(len > 0, "NULL_LENGTH");

    for (uint256 i = 0; i < len; i++) {
      Round storage round = rounds[_roundKeys[i]];

      _updateRound(round.pool, round.inputToken, round.outputToken);
      _checkRoundBeforeExecute(_roundKeys[i], round);

      require(round.endTime + minInterval <= block.timestamp, "MIN_INTERVAL");
      if (_bySlasher) {
        require(round.endTime + maxInterval <= block.timestamp, "MAX_INTERVAL");
      }

      uint256 inputAmountWithFee = _takeAmountFee(round.pool, round.inputToken, round.totalInputAmount);
      require(round.inputToken == round.pool || round.outputToken == round.pool, "UNKNOWN_ROUND_ACTION");

      if (round.inputToken == round.pool) {
        _redeemPool(round, inputAmountWithFee);
      } else {
        _supplyPool(round, inputAmountWithFee);
      }
      emit SupplyAndRedeemPoke(
        _roundKeys[i],
        round.pool,
        round.inputToken,
        round.outputToken,
        round.totalInputAmount,
        round.totalOutputAmount
      );
    }
  }

  function _supplyPool(Round storage round, uint256 totalInputAmount) internal {
    PoolType pType = poolType[round.pool];
    if (pType == PoolType.PIPT) {
      Erc20PiptSwap piptSwap = Erc20PiptSwap(payable(poolPiptSwap[round.pool]));
      if (round.inputToken == ETH) {
        (round.totalOutputAmount, ) = piptSwap.swapEthToPipt{ value: totalInputAmount }(piptSwap.defaultSlippage());
      } else {
        round.totalOutputAmount = piptSwap.swapErc20ToPipt(
          round.inputToken,
          totalInputAmount,
          piptSwap.defaultSlippage()
        );
      }
    } else if (pType == PoolType.VAULT) {
      (uint256 poolAmountOut, uint256[] memory tokensInPipt) = _depositVaultAndGetTokensInPipt(round, totalInputAmount);

      PowerIndexPoolInterface(round.pool).joinPool(poolAmountOut, tokensInPipt);
      (, uint256 communityFee, , ) = PowerIndexPoolInterface(round.pool).getCommunityFee();
      round.totalOutputAmount = poolAmountOut.sub(poolAmountOut.mul(communityFee).div(1 ether)) - 1;
    }
  }

  function _depositVaultAndGetTokensInPipt(Round storage round, uint256 totalInputAmount)
    internal
    returns (uint256 poolAmountOut, uint256[] memory tokensInPipt)
  {
    uint256 len = poolTokens[round.pool].length;
    uint256 piptTotalSupply = PowerIndexPoolInterface(round.pool).totalSupply();

    (VaultCalc[] memory vc, uint256 restInput, uint256 totalCorrectInput) =
      getVaultCalcsForSupply(round.pool, piptTotalSupply, totalInputAmount);

    tokensInPipt = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      uint256 share = vc[i].correctInput.mul(1 ether).div(totalCorrectInput);
      vc[i].correctInput = vc[i].correctInput.add(restInput.mul(share).div(1 ether)).sub(100);

      IVault(vc[i].token).deposit(_addYearnLpTokenLiquidity(vaultConfig[vc[i].token], vc[i].correctInput));
      tokensInPipt[i] = IVault(vc[i].token).balanceOf(address(this));

      uint256 poolOutByToken = tokensInPipt[i].sub(1e6).mul(piptTotalSupply).div(vc[i].tokenBalance);
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

  function _redeemPool(Round storage round, uint256 totalInputAmount) internal {
    PoolType pType = poolType[round.pool];
    if (pType == PoolType.PIPT) {
      Erc20PiptSwap piptSwap = Erc20PiptSwap(payable(poolPiptSwap[round.pool]));
      if (round.inputToken == ETH) {
        round.totalOutputAmount = piptSwap.swapPiptToEth(totalInputAmount);
      } else {
        round.totalOutputAmount = piptSwap.swapPiptToErc20(round.outputToken, totalInputAmount);
      }
    } else if (pType == PoolType.VAULT) {
      round.totalOutputAmount = _redeemVault(round, totalInputAmount);
    }
  }

  function _redeemVault(Round storage round, uint256 totalInputAmount) internal returns (uint256 totalOutputAmount) {
    address[] memory tokens = poolTokens[round.pool];
    uint256 len = tokens.length;

    uint256[] memory amounts = new uint256[](len);
    PowerIndexPoolInterface(round.pool).exitPool(totalInputAmount, amounts);

    uint256 outputTokenBalanceBefore = IERC20(round.outputToken).balanceOf(address(this));
    for (uint256 i = 0; i < len; i++) {
      VaultConfig storage vc = vaultConfig[tokens[i]];
      IVault(tokens[i]).withdraw(IERC20(tokens[i]).balanceOf(address(this)));
      IVaultDepositor2(vc.depositor).remove_liquidity_one_coin(
        IERC20(vc.lpToken).balanceOf(address(this)),
        int128(vc.depositorIndex),
        1
      );
    }
    totalOutputAmount = IERC20(round.outputToken).balanceOf(address(this)).sub(outputTokenBalanceBefore);
  }

  function _claimPoke(
    bytes32 _roundKey,
    address[] memory _claimForList,
    bool _bySlasher
  ) internal {
    (uint256 minInterval, uint256 maxInterval) = _getMinMaxReportInterval();

    uint256 len = _claimForList.length;
    require(len > 0, "NULL_LENGTH");

    Round storage round = rounds[_roundKey];
    require(round.endTime + minInterval <= block.timestamp, "MIN_INTERVAL");
    if (_bySlasher) {
      require(round.endTime + maxInterval <= block.timestamp, "MAX_INTERVAL");
    }
    require(round.totalOutputAmount != 0, "TOTAL_OUTPUT_NULL");

    for (uint256 i = 0; i < len; i++) {
      address _claimFor = _claimForList[i];
      require(round.inputAmount[_claimFor] != 0, "INPUT_NULL");
      require(round.outputAmount[_claimFor] == 0, "OUTPUT_NOT_NULL");

      uint256 inputShare = round.inputAmount[_claimFor].mul(1 ether).div(round.totalInputAmount);
      uint256 outputAmount = round.totalOutputAmount.mul(inputShare).div(1 ether);
      round.outputAmount[_claimFor] = outputAmount;
      round.totalOutputAmountClaimed = round.totalOutputAmountClaimed.add(outputAmount).add(10);
      IERC20(round.outputToken).safeTransfer(_claimFor, outputAmount - 1);

      emit ClaimPoke(
        _roundKey,
        round.pool,
        _claimFor,
        round.inputToken,
        round.outputToken,
        round.inputAmount[_claimFor],
        outputAmount
      );
    }
  }

  function _takeAmountFee(
    address _pool,
    address _inputToken,
    uint256 _amount
  ) internal returns (uint256 amountWithFee) {
    if (feeByToken[_inputToken] == 0) {
      return _amount;
    }
    amountWithFee = _amount.sub(_amount.mul(feeByToken[_inputToken]).div(1 ether));
    if (amountWithFee != _amount) {
      pendingFeeByToken[_inputToken] = pendingFeeByToken[_inputToken].add(_amount.sub(amountWithFee));
      emit TakeFee(_pool, _inputToken, _amount.sub(amountWithFee));
    }
  }

  function _checkRoundBeforeExecute(bytes32 _roundKey, Round storage round) internal {
    bytes32 partialKey = getRoundPartialKey(round.pool, round.inputToken, round.outputToken);

    require(lastRoundByPartialKey[partialKey] != _roundKey, "CURRENT_ROUND");
    require(round.totalInputAmount != 0, "TOTAL_INPUT_NULL");
    require(round.totalOutputAmount == 0, "TOTAL_OUTPUT_NOT_NULL");
  }

  function _updateRound(
    address _pool,
    address _inputToken,
    address _outputToken
  ) internal returns (bytes32 roundKey) {
    bytes32 partialKey = getRoundPartialKey(_pool, _inputToken, _outputToken);
    roundKey = lastRoundByPartialKey[partialKey];

    if (roundKey == bytes32(0) || isRoundReadyToExecute(roundKey)) {
      if (roundKey != bytes32(0)) {
        emit FinishRound(
          roundKey,
          _pool,
          _inputToken,
          rounds[roundKey].totalInputAmount,
          tokenCap[_inputToken],
          rounds[roundKey].endTime,
          block.timestamp
        );
        rounds[roundKey].endTime = block.timestamp;
      }
      roundKey = getCurrentBlockRoundKey(_pool, _inputToken, _outputToken);
      rounds[roundKey].blockNumber = block.number;
      rounds[roundKey].pool = _pool;
      rounds[roundKey].inputToken = _inputToken;
      rounds[roundKey].outputToken = _outputToken;
      rounds[roundKey].endTime = block.timestamp.add(roundPeriod);
      lastRoundByPartialKey[partialKey] = roundKey;
      emit InitRound(roundKey, _pool, rounds[roundKey].endTime, _inputToken, _outputToken);
    }

    return roundKey;
  }

  function _updatePool(address _pool) internal {
    poolTokens[_pool] = PowerIndexPoolInterface(_pool).getCurrentTokens();
    if (poolType[_pool] == PoolType.VAULT) {
      uint256 len = poolTokens[_pool].length;
      for (uint256 i = 0; i < len; i++) {
        IERC20(poolTokens[_pool][i]).approve(_pool, uint256(-1));
      }
    }
  }

  function _reward(
    uint256 _reporterId,
    uint256 _gasStart,
    uint256 _compensationPlan,
    bytes calldata _rewardOpts
  ) internal {
    powerPoke.reward(_reporterId, _gasStart.sub(gasleft()), _compensationPlan, _rewardOpts);
  }

  function _getMinMaxReportInterval() internal view returns (uint256 min, uint256 max) {
    (min, max) = powerPoke.getMinMaxReportIntervals(address(this));
    min = min == 1 ? 0 : min;
  }
}
