pragma solidity 0.6.12;

import "./interfaces/BPoolInterface.sol";
import "./interfaces/TokenInterface.sol";
import "./IPoolRestrictions.sol";
import "./uniswapv2/interfaces/IUniswapV2Pair.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@nomiclabs/buidler/console.sol";

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

    mapping(address => address) public uniswapEthPairByTokenAddress;
    mapping(address => bool) public reApproveTokens;
    uint256 defaultSlippage;

    struct CalculationStruct {
        uint256 tokenShare;
        uint256 ethRequired;
        uint256 tokenReserve;
        uint256 ethReserve;
    }

    event SetTokenSetting(address indexed token, bool reApprove, address uniswapPair);
    event SetDefaultSlippage(uint256 newDefaultSlippage);
    event SetFees(address indexed sender, uint256[] newFeeLevels, uint256[] newFeeAmounts, address indexed feePayout, address indexed feeManager);

    event EthToPiptSwap(address indexed user, uint256 ethSwapAmount, uint256 piptAmount, uint256 piptCommunityFee);
    event OddEth(address indexed user, uint256 amount);
    event PayoutCVP(address indexed receiver, uint256 wethAmount, uint256 cvpAmount);

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
        defaultSlippage = 0.01 ether;
    }

    modifier onlyFeeManager() {
        require(msg.sender == feeManager, "NOT_FEE_MANAGER");
        _;
    }

    receive() external payable {
        if (msg.sender != tx.origin) {
            return;
        }
        swapEthToPipt(defaultSlippage);
    }


    function swapEthToPipt(uint256 _slippage) public payable {
        (, uint256 swapAmount) = calcEthFee(msg.value);

        address[] memory tokens = pipt.getCurrentTokens();

        (
            uint256[] memory tokensInPipt,
            uint256[] memory ethInUniswap,
            uint256 poolAmountOut
        ) = getEthAndTokensIn(swapAmount, tokens, _slippage);

        swapEthToPiptByInputs(tokensInPipt, ethInUniswap, poolAmountOut);
    }

    function swapEthToPiptByInputs(
        uint256[] memory tokensInPipt,
        uint256[] memory ethInUniswap,
        uint256 poolAmountOut
    )
        public
        payable
    {
        {
            address poolRestrictions = pipt.getRestrictions();
            if(address(poolRestrictions) != address(0)) {
                uint maxTotalSupply = IPoolRestrictions(poolRestrictions).getMaxTotalSupply(address(pipt));
                require(pipt.totalSupply().add(poolAmountOut) <= maxTotalSupply, "MAX_SUPPLY");
            }
        }

        require(msg.value > 0, "ETH required");
        weth.deposit.value(msg.value)();

        (, uint256 swapAmount) = calcEthFee(msg.value);
//
        uint piptTotalSupply = pipt.totalSupply();
        uint ratio = poolAmountOut.mul(1 ether).div(piptTotalSupply).add(10);

        address[] memory tokens = pipt.getCurrentTokens();
        uint256 len = tokens.length;

        uint256 totalEthSwap = 0;
        for(uint256 i = 0; i < len; i++) {
            IUniswapV2Pair tokenPair = uniswapPairFor(tokens[i]);

            (uint256 tokenReserve, uint256 ethReserve,) = tokenPair.getReserves();
            tokensInPipt[i] = ratio.mul(pipt.getBalance(tokens[i])).div(1 ether);
            ethInUniswap[i] = getAmountIn(tokensInPipt[i], ethReserve, tokenReserve);

            weth.transfer(address(tokenPair), ethInUniswap[i]);

            tokenPair.swap(tokensInPipt[i], uint(0), address(this), new bytes(0));
            totalEthSwap = totalEthSwap.add(ethInUniswap[i]);

            if(reApproveTokens[tokens[i]]) {
                TokenInterface(tokens[i]).approve(address(pipt), 0);
            }

            TokenInterface(tokens[i]).approve(address(pipt), tokensInPipt[i]);
        }

        (, uint communityJoinFee, ,) = pipt.getCommunityFee();
        (uint poolAmountOutAfterFee, uint poolAmountOutFee) = pipt.calcAmountWithCommunityFee(
            poolAmountOut,
            communityJoinFee,
            address(this)
        );

        emit EthToPiptSwap(msg.sender, swapAmount, poolAmountOut, poolAmountOutFee);

        pipt.joinPool(poolAmountOut, tokensInPipt);
        pipt.transfer(msg.sender, poolAmountOutAfterFee);

        uint256 ethDiff = swapAmount.sub(totalEthSwap);
        if (ethDiff > 0) {
            weth.withdraw(ethDiff);
            msg.sender.transfer(ethDiff);
            emit OddEth(msg.sender, ethDiff);
        }
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

    function getEthAndTokensIn(uint256 _ethValue, address[] memory _tokens, uint256 _slippage) public view returns(
        uint256[] memory tokensInPipt,
        uint256[] memory ethInUniswap,
        uint256 poolOut
    ) {
        _ethValue = _ethValue.sub(_ethValue.mul(_slippage).div(1 ether));

        // get shares and eth required for each share
        CalculationStruct[] memory calculations = new CalculationStruct[](_tokens.length);

        uint256 totalEthRequired = 0;
        {
            uint256 piptTotalSupply = pipt.totalSupply();
            // get pool out for 1 ether as 100% for calculate shares
            // poolOut by 1 ether first token join = piptTotalSupply.mul(1 ether).div(pipt.getBalance(_tokens[0]))
            // poolRatio = poolOut/totalSupply
            uint256 poolRatio = piptTotalSupply.mul(1 ether).div(pipt.getBalance(_tokens[0])).mul(1 ether).div(piptTotalSupply);

            for (uint i = 0; i < _tokens.length; i++) {
                calculations[i].tokenShare = poolRatio.mul(pipt.getBalance(_tokens[i])).div(1 ether);

                calculations[i].tokenShare = calculations[i].tokenShare.add(calculations[i].tokenShare);

                (calculations[i].tokenReserve, calculations[i].ethReserve,) = uniswapPairFor(_tokens[i]).getReserves();
                calculations[i].ethRequired = getAmountIn(
                    calculations[i].tokenShare,
                    calculations[i].ethReserve,
                    calculations[i].tokenReserve
                );
                totalEthRequired = totalEthRequired.add(calculations[i].ethRequired);
            }
        }

        // calculate eth and tokensIn based on shares and normalize if totalEthRequired more than 100%
        tokensInPipt = new uint256[](_tokens.length);
        ethInUniswap = new uint256[](_tokens.length);
        for (uint i = 0; i < _tokens.length; i++) {
            ethInUniswap[i] = _ethValue.mul(calculations[i].ethRequired.mul(1 ether).div(totalEthRequired)).div(1 ether);
            tokensInPipt[i] = calculations[i].tokenShare.mul(_ethValue.mul(1 ether).div(totalEthRequired)).div(1 ether);
        }

        poolOut = pipt.totalSupply().mul(tokensInPipt[0]).div(pipt.getBalance(_tokens[0]));
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

    function setTokensSettings(
        address[] memory _tokens,
        address[] memory _pairs,
        bool[] memory _reapprove
    ) external onlyOwner {
        uint256 len = _tokens.length;
        require(len == _pairs.length && len == _reapprove.length, "Lengths are not equal");
        for(uint i = 0; i < _tokens.length; i++) {
            uniswapEthPairByTokenAddress[_tokens[i]] = _pairs[i];
            reApproveTokens[_tokens[i]] = _reapprove[i];
            emit SetTokenSetting(_tokens[i], _reapprove[i], _pairs[i]);
        }
    }

    function setDefaultSlippage(uint256 _defaultSlippage) external onlyOwner {
        defaultSlippage = _defaultSlippage;
        emit SetDefaultSlippage(_defaultSlippage);
    }

    function uniswapPairFor(address token) internal view returns(IUniswapV2Pair) {
        return IUniswapV2Pair(uniswapEthPairByTokenAddress[token]);
    }

    function calcEthFee(uint256 ethValue) public view returns(uint256 ethFee, uint256 ethAfterFee) {
        ethFee = 0;
        uint len = feeLevels.length;
        for(uint i = 0; i < len; i++) {
            if(ethValue >= feeLevels[i]) {
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