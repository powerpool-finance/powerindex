pragma solidity 0.6.12;

import "./interfaces/BPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./IPoolRestrictions.sol";
import "./uniswapv2/interfaces/IUniswapV2Pair.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract EthPiptSwap is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for TokenInterface;

    address private constant ETH_ADDRESS = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    TokenInterface public weth;
    TokenInterface public cvp;
    BPoolInterface public pipt;

    uint256[] public feeLevels;
    uint256[] public feeAmounts;
    address public feePayout;
    address public feeManager;

    mapping(address => address) uniswapEthPairByTokenAddress;

    struct CalculationStruct {
        uint256 tokenShare;
        uint256 ethRequired;
        uint256 tokenReserve;
        uint256 ethReserve;
    }

    event EthToPiptSwap(address indexed user, uint256 ethAmount, uint256 piptAmount, uint256 ethFee, uint256 piptCommunityFee);
    event OddEth(address indexed user, uint256 amount);
    event PayoutCVP(address indexed receiver, uint256 wethAmount, uint256 cvpAmount);
    event SetFees(address indexed sender, uint256[] newFeeLevels, uint256[] newFeeAmounts, address indexed feePayout, address indexed feeManager);

    constructor(
        address _weth,
        address _cvp,
        address _pipt,
        address _feeManager
    ) public Ownable() {
        weth = TokenInterface(_weth);
        cvp = TokenInterface(_cvp);
        pipt = BPoolInterface(_pipt);
        feeManager = _feeManager;
    }

    modifier onlyFeeManager() {
        require(msg.sender == feeManager, "NOT_FEE_MANAGER");
        _;
    }

    receive() external payable {
        if (msg.sender != tx.origin) {
            return;
        }
        (, uint256 swapAmount) = calcEthFee(msg.value);

        address[] memory tokens = pipt.getCurrentTokens();

        (
            uint256[] memory tokensInPipt,
            uint256[] memory ethInUniswap,
            uint256 poolAmountOut
        ) = getEthAndTokensIn(swapAmount, tokens);

        swapEthToPipt(tokensInPipt, ethInUniswap, poolAmountOut);
    }

    function swapEthToPipt(
        uint256[] memory tokensInPipt,
        uint256[] memory ethInUniswap,
        uint256 poolAmountOut
    )
        public
        payable
    {
        address poolRestrictions = pipt.getRestrictions();
        if(address(poolRestrictions) != address(0)) {
            uint maxTotalSupply = IPoolRestrictions(poolRestrictions).getMaxTotalSupply(address(pipt));
            require(pipt.totalSupply().add(poolAmountOut) <= maxTotalSupply, "MAX_SUPPLY");
        }

        require(msg.value > 0, "ETH required");
        weth.deposit.value(msg.value)();

        (uint256 feeAmount, uint256 swapAmount) = calcEthFee(msg.value);

        address[] memory tokens = pipt.getCurrentTokens();
        uint256 len = tokens.length;

        uint256 totalEthSwap = 0;
        for(uint256 i = 0; i < len; i++) {
            IUniswapV2Pair tokenPair = uniswapPairFor(tokens[i]);

            (uint256 tokenReserve, uint256 ethReserve,) = tokenPair.getReserves();
            tokensInPipt[i] = getAmountOut(ethInUniswap[i], ethReserve, tokenReserve);

            weth.transfer(address(tokenPair), ethInUniswap[i]);

            tokenPair.swap(tokensInPipt[i], uint(0), address(this), new bytes(0));
            totalEthSwap = totalEthSwap.add(ethInUniswap[i]);

            TokenInterface(tokens[i]).approve(address(pipt), tokensInPipt[i]);
        }

        (, uint communityJoinFee, ,) = pipt.getCommunityFee();
        (uint poolAmountOutAfterFee, uint poolAmountOutFee) = pipt.calcAmountWithCommunityFee(
            poolAmountOut,
            communityJoinFee,
            address(this)
        );

        emit EthToPiptSwap(msg.sender, msg.value, poolAmountOut, feeAmount, poolAmountOutFee);

        pipt.joinPool(poolAmountOut, tokensInPipt);
        pipt.transfer(msg.sender, poolAmountOutAfterFee);

        uint256 ethDiff = swapAmount.sub(totalEthSwap);
        if (ethDiff > 0) {
            weth.withdraw(ethDiff);
            msg.sender.transfer(ethDiff);
            emit OddEth(msg.sender, ethDiff);
        }
    }

    function setFees(
        uint256[] calldata _feeLevels,
        uint256[] calldata _feeAmounts,
        address _feePayout,
        address _feeManager
    )
        external
        onlyFeeManager
    {
        feeLevels = _feeLevels;
        feeAmounts = _feeAmounts;
        feePayout = _feePayout;
        feeManager = _feeManager;

        emit SetFees(msg.sender, _feeLevels, _feeAmounts, _feePayout, _feeManager);
    }

    function convertOddToCvpAndSendToPayout(address[] memory oddTokens) public {
        require(msg.sender == tx.origin, "Call from contract not allowed");

        uint256 len = oddTokens.length;

        uint256 totalEthSwap = 0;
        for(uint256 i = 0; i < len; i++) {
            uint256 tokenBalance = TokenInterface(oddTokens[i]).balanceOf(address(this));
            IUniswapV2Pair tokenPair = uniswapPairFor(oddTokens[i]);

            (uint256 tokenReserve, uint256 ethReserve,) = tokenPair.getReserves();
            uint256 wethOut = getAmountOut(tokenBalance, tokenReserve, ethReserve);

            TokenInterface(oddTokens[i]).transfer(address(tokenPair), tokenBalance);

            tokenPair.swap(uint(0), wethOut, address(this), new bytes(0));
        }

        uint256 wethBalance = weth.balanceOf(address(this));

        IUniswapV2Pair cvpPair = uniswapPairFor(address(cvp));

        (uint256 cvpReserve, uint256 ethReserve,) = cvpPair.getReserves();
        uint256 cvpOut = getAmountOut(wethBalance, ethReserve, cvpReserve);

        weth.transfer(address(cvpPair), wethBalance);

        cvpPair.swap(cvpOut, uint(0), address(this), new bytes(0));

        cvp.transfer(feePayout, cvpOut);

        emit PayoutCVP(feePayout, wethBalance, cvpOut);
    }

    function getEthAndTokensIn(uint256 _ethValue, address[] memory tokens) public view returns(
        uint256[] memory tokensInPipt,
        uint256[] memory ethInUniswap,
        uint256 poolOut
    ) {
        uint256 piptTotalSupply = pipt.totalSupply();

        uint256 firstTokenBalance = pipt.getBalance(tokens[0]);

        // get pool out for 1 ether as 100% for calculate shares
        uint256 totalPoolOut = piptTotalSupply.mul(1 ether).div(firstTokenBalance);
        uint256 poolRatio = totalPoolOut.mul(1 ether).div(piptTotalSupply);

        uint256 i = 0;

        // get shares and eth required for each share
        CalculationStruct[] memory calculations = new CalculationStruct[](tokens.length);
        uint256 totalEthRequired = 0;
        for (i = 0; i < tokens.length; i++) {
            calculations[i].tokenShare = poolRatio.mul(pipt.getBalance(tokens[i])).div(1 ether);
            (calculations[i].tokenReserve, calculations[i].ethReserve,) = uniswapPairFor(tokens[i]).getReserves();
            calculations[i].ethRequired = getAmountIn(
                calculations[i].tokenShare,
                calculations[i].ethReserve,
                calculations[i].tokenReserve
            );
            totalEthRequired = totalEthRequired.add(calculations[i].ethRequired);
        }

        // calculate eth and tokensIn based on shares and normalize if totalEthRequired more than 100%
        tokensInPipt = new uint256[](tokens.length);
        ethInUniswap = new uint256[](tokens.length);
        for (i = 0; i < tokens.length; i++) {
            ethInUniswap[i] = _ethValue.mul(calculations[i].ethRequired.mul(1 ether).div(totalEthRequired)).div(1 ether);
//            tokensInPipt[i] = calculations[i].tokenShare.mul(ethInUniswap[i]).div(calculations[i].ethRequired);
            tokensInPipt[i] = getAmountOut(ethInUniswap[i], calculations[i].ethReserve, calculations[i].tokenReserve);
        }

        poolOut = piptTotalSupply.mul(tokensInPipt[0]).div(firstTokenBalance);
        poolOut = poolOut.mul(999999).div(1000000);
    }

    function setUniswapPairFor(address[] memory _tokens, address[] memory _pairs) external onlyOwner {
        uint256 len = _tokens.length;
        require(len == _pairs.length, "Lengths are not equal");
        for(uint i = 0; i < _tokens.length; i++) {
            uniswapEthPairByTokenAddress[_tokens[i]] = _pairs[i];
        }
    }

    function uniswapPairFor(address token) internal view returns(IUniswapV2Pair) {
        return IUniswapV2Pair(uniswapEthPairByTokenAddress[token]);
    }

    function calcEthFee(uint256 ethValue) public view returns(uint256 ethFee, uint256 ethAfterFee) {
        ethFee = 0;
        uint len = feeLevels.length;
        for(uint i = 0; i < len; i++) {
            if(feeLevels[i] >= ethValue) {
                ethFee = ethValue.mul(feeAmounts[i]).div(1 ether);
                break;
            }
        }
        ethAfterFee = ethValue.sub(ethFee);
    }

    // given an output amount of an asset and pair reserves, returns a required input amount of the other asset
    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) public pure returns (uint amountIn) {
        require(amountOut > 0, 'UniswapV2Library: INSUFFICIENT_OUTPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'UniswapV2Library: INSUFFICIENT_LIQUIDITY');
        uint numerator = reserveIn.mul(amountOut).mul(1000);
        uint denominator = reserveOut.sub(amountOut).mul(997);
        amountIn = (numerator / denominator).add(1);
    }

    // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) public pure returns (uint amountOut) {
        require(amountIn > 0, 'UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'UniswapV2Library: INSUFFICIENT_LIQUIDITY');
        uint amountInWithFee = amountIn.mul(997);
        uint numerator = amountInWithFee.mul(reserveOut);
        uint denominator = reserveIn.mul(1000).add(amountInWithFee);
        amountOut = numerator / denominator;
    }
}