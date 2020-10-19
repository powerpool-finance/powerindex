pragma solidity 0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./interfaces/BPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./uniswapv2/interfaces/IUniswapV2Pair.sol";

contract ExchangeProxy {
    using SafeMath for uint256;
    using SafeERC20 for TokenInterface;

    address private constant ETH_ADDRESS = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    TokenInterface public weth;
    BPoolInterface public pipt;
    uint256 public fee;
    address public feePayout;
    address public feeManager;

    mapping(address => address) uniswapEthPairByTokenAddress;

    struct CalculationStruct {
        uint256 tokenShare;
        uint256 ethRequired;
    }

    constructor(
        address _weth,
        address _pipt,
        address _uniswapRouter,
        uint256 _fee,
        address _feePayout,
        address _feeManager
    ) public {
        weth = TokenInterface(_weth);
        pipt = BPoolInterface(_pipt);
        fee = _fee;
        fee = _fee;
        feePayout = _feePayout;
        feeManager = _feeManager;
    }

    receive() external payable {
        (, uint256 swapAmount) = takeEthFee(msg.value);

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
        weth.deposit.value(msg.value)();

        (uint256 feeAmount, uint256 swapAmount) = takeEthFee(msg.value);

        address[] memory tokens = pipt.getCurrentTokens();
        uint256 len = tokens.length;

        uint256 totalEthSwap = 0;
        for(uint256 i = 0; i < len; i++) {
            IUniswapV2Pair tokenPair = uniswapPairFor(tokens[i]);
            weth.approve(address(tokenPair), ethInUniswap[i]);
            tokenPair.swap(tokensInPipt[i], uint(0), address(this), new bytes(0));
            //TODO: add swap check
            totalEthSwap = totalEthSwap.add(ethInUniswap[i]);
        }

        pipt.joinPool(poolAmountOut, tokensInPipt);

        pipt.transfer(msg.sender, poolAmountOut);
        uint256 ethDiff = swapAmount.sub(totalEthSwap);
        if (ethDiff > 0) {
            weth.safeTransfer(msg.sender, ethDiff);
        }

        weth.safeTransfer(feePayout, feeAmount);
    }

    function getEthAndTokensIn(uint256 _ethValue, address[] memory tokens) public returns(
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
            (uint256 tokenReserve, uint256 ethReserve,) = uniswapPairFor(tokens[i]).getReserves();
            calculations[i].ethRequired = getAmountIn(calculations[i].tokenShare, tokenReserve, ethReserve);
            totalEthRequired = totalEthRequired.add(calculations[i].ethRequired);
        }

        // calculate eth and tokensIn based on shares and normalize if totalEthRequired more than 100%
        tokensInPipt = new uint256[](tokens.length);
        ethInUniswap = new uint256[](tokens.length);
        for (i = 0; i < tokens.length; i++) {
            if (totalEthRequired > 1 ether) {
                ethInUniswap[i] = _ethValue.mul(calculations[i].ethRequired.mul(1 ether).div(totalEthRequired)).div(1 ether);
                tokensInPipt[i] = calculations[i].tokenShare.mul(calculations[i].ethRequired.mul(1 ether).div(totalEthRequired)).div(1 ether);
            } else {
                ethInUniswap[i] = _ethValue.mul(calculations[i].ethRequired).div(1 ether);
                tokensInPipt[i] = calculations[i].tokenShare.mul(calculations[i].ethRequired).div(1 ether);
            }
        }

        poolOut = piptTotalSupply.mul(tokensInPipt[0]).div(firstTokenBalance);
    }

    function uniswapPairFor(address token) internal returns(IUniswapV2Pair) {
        return IUniswapV2Pair(uniswapEthPairByTokenAddress[token]);
    }

    function takeEthFee(uint256 ethValue) public returns(uint256 ethFee, uint256 ethAfterFee) {
        ethFee = ethValue.mul(fee).div(1 ether);
        ethAfterFee = ethValue.sub(ethFee);
    }

    // given an output amount of an asset and pair reserves, returns a required input amount of the other asset
    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) internal pure returns (uint amountIn) {
        require(amountOut > 0, 'UniswapV2Library: INSUFFICIENT_OUTPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'UniswapV2Library: INSUFFICIENT_LIQUIDITY');
        uint numerator = reserveIn.mul(amountOut).mul(1000);
        uint denominator = reserveOut.sub(amountOut).mul(997);
        amountIn = (numerator / denominator).add(1);
    }
}