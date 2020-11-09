// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/BPoolInterface.sol";
import "./interfaces/WrappedPiErc20Interface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./lib/ControllerOwnable.sol";
import "./interfaces/BPoolWrapperInterface.sol";


contract BPoolWrapper is ControllerOwnable, BPoolWrapperInterface {
    using SafeMath for uint256;

    event SetWrapper(address indexed token, address indexed wrapper);

    BPoolInterface public immutable bpool;

    mapping(address => address) public wrapperByToken;
    mapping(address => address) public tokenByWrapper;

    constructor(address _bpool) public ControllerOwnable() {
        bpool = BPoolInterface(_bpool);
    }

    function setTokenWrapperList(address[] calldata _tokens, address[] calldata _wrappers) external override onlyController {
        uint len = _tokens.length;
        require(len == _wrappers.length, "LENGTH_DONT_MATCH");

        for (uint i = 0; i < len; i++) {
            _setTokenWrapper(_tokens[i], _wrappers[i]);
        }
    }

    function setTokenWrapper(address _token, address _wrapper) external override onlyController {
        _setTokenWrapper(_token, _wrapper);
    }

    function swapExactAmountOut(
        address tokenIn,
        uint maxAmountIn,
        address tokenOut,
        uint tokenAmountOut,
        uint maxPrice
    )
        external
        returns (uint tokenAmountIn, uint spotPriceAfter)
    {
        address factTokenIn = _processTokenIn(tokenIn, maxAmountIn);

        (tokenAmountIn, spotPriceAfter) = bpool.swapExactAmountOut(
            factTokenIn,
            maxAmountIn,
            tokenOut,
            tokenAmountOut,
            maxPrice
        );

        _processTokenOut(tokenIn, maxAmountIn.sub(tokenAmountIn));
        _processTokenOutBalance(tokenOut);

        return (tokenAmountIn, spotPriceAfter);
    }

    function swapExactAmountIn(
        address tokenIn,
        uint tokenAmountIn,
        address tokenOut,
        uint minAmountOut,
        uint maxPrice
    )
        external
        returns (uint tokenAmountOut, uint spotPriceAfter)
    {
        address factTokenIn = _processTokenIn(tokenIn, tokenAmountIn);

        (tokenAmountOut, spotPriceAfter) = bpool.swapExactAmountIn(
            factTokenIn,
            tokenAmountIn,
            tokenOut,
            minAmountOut,
            maxPrice
        );

        _processTokenOutBalance(tokenOut);

        return (tokenAmountOut, spotPriceAfter);
    }

    function joinPool(
        uint poolAmountOut,
        uint[] calldata maxAmountsIn
    ) external {
        address[] memory tokens = bpool.getFinalTokens();
        require(maxAmountsIn.length == tokens.length, "ERR_LENGTH_MISMATCH");

        for (uint i = 0; i < tokens.length; i++) {
            _processTokenOrWrapperIn(tokens[i], maxAmountsIn[i]);
        }
        bpool.joinPool(poolAmountOut, maxAmountsIn);
        for (uint i = 0; i < tokens.length; i++) {
            _processTokenOrWrapperOutBalance(tokens[i]);
        }
        require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
    }

    function exitPool(
        uint poolAmountIn,
        uint[] calldata minAmountsOut
    ) external {
        address[] memory tokens = bpool.getFinalTokens();
        require(minAmountsOut.length == tokens.length, "ERR_LENGTH_MISMATCH");

        bpool.transferFrom(msg.sender, address(this), poolAmountIn);
        bpool.approve(address(bpool), poolAmountIn);
        bpool.exitPool(poolAmountIn, minAmountsOut);

        for (uint i = 0; i < tokens.length; i++) {
            _processTokenOrWrapperOutBalance(tokens[i]);
        }
    }

    function joinswapExternAmountIn(
        address tokenIn,
        uint tokenAmountIn,
        uint minPoolAmountOut
    )
        external
        returns (uint poolAmountOut)
    {
        address factTokenIn = _processTokenIn(tokenIn, tokenAmountIn);
        poolAmountOut = bpool.joinswapExternAmountIn(factTokenIn, tokenAmountIn, minPoolAmountOut);
        require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
        return poolAmountOut;
    }

    function joinswapPoolAmountOut(
        address tokenIn,
        uint poolAmountOut,
        uint maxAmountIn
    )
        external
        returns (uint tokenAmountIn)
    {
        address factTokenIn = _processTokenIn(tokenIn, maxAmountIn);
        tokenAmountIn = bpool.joinswapPoolAmountOut(factTokenIn, poolAmountOut, maxAmountIn);
        _processTokenOut(tokenIn, maxAmountIn.sub(tokenAmountIn));
        require(bpool.transfer(msg.sender, bpool.balanceOf(address(this))), "ERR_TRANSFER_FAILED");
        return tokenAmountIn;
    }

    function exitswapPoolAmountIn(
        address tokenOut,
        uint poolAmountIn,
        uint minAmountOut
    )
        external
        returns (uint tokenAmountOut)
    {
        require(bpool.transferFrom(msg.sender, address(this), poolAmountIn), "ERR_TRANSFER_FAILED");
        bpool.approve(address(bpool), poolAmountIn);

        address factTokenOut = _getFactToken(tokenOut);
        tokenAmountOut = bpool.exitswapPoolAmountIn(factTokenOut, poolAmountIn, minAmountOut);
        _processTokenOutBalance(tokenOut);
        return tokenAmountOut;
    }

    function exitswapExternAmountOut(
        address tokenOut,
        uint tokenAmountOut,
        uint maxPoolAmountIn
    )
        external
        returns (uint poolAmountIn)
    {
        require(bpool.transferFrom(msg.sender, address(this), maxPoolAmountIn), "ERR_TRANSFER_FAILED");
        bpool.approve(address(bpool), maxPoolAmountIn);

        address factTokenOut = _getFactToken(tokenOut);
        poolAmountIn = bpool.exitswapExternAmountOut(factTokenOut, tokenAmountOut, maxPoolAmountIn);
        _processTokenOut(tokenOut, tokenAmountOut);
        require(bpool.transfer(msg.sender, maxPoolAmountIn.sub(poolAmountIn)), "ERR_TRANSFER_FAILED");
        return poolAmountIn;
    }

    function calcInGivenOut(
        uint tokenBalanceIn,
        uint tokenWeightIn,
        uint tokenBalanceOut,
        uint tokenWeightOut,
        uint tokenAmountOut,
        uint swapFee
    )
        public
        view
        returns (uint tokenAmountIn)
    {
        return bpool.calcInGivenOut(
            tokenBalanceIn,
            tokenWeightIn,
            tokenBalanceOut,
            tokenWeightOut,
            tokenAmountOut,
            swapFee
        );
    }

    function getBalance(address token) external view returns (uint) {
        return bpool.getBalance(token);
    }

    function getDenormalizedWeight(address token) external view returns (uint) {
        return bpool.getDenormalizedWeight(token);
    }

    function getSwapFee() external view returns (uint) {
        return bpool.getSwapFee();
    }

    function _processTokenIn(address token, uint amount) internal returns(address factToken) {
        if (amount == 0) {
            return token;
        }
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "ERR_TRANSFER_FAILED");

        address wrapper = wrapperByToken[token];
        if (wrapper == address(0)) {
            if (IERC20(token).allowance(address(this), address(bpool)) > 0) {
                IERC20(token).approve(address(bpool), 0);
            }
            IERC20(token).approve(address(bpool), amount);
            return token;
        }

        if (IERC20(token).allowance(address(this), wrapper) > 0) {
            IERC20(token).approve(wrapper, 0);
        }
        IERC20(token).approve(wrapper, amount);
        WrappedPiErc20Interface(wrapper).deposit(amount);
        WrappedPiErc20Interface(wrapper).approve(address(bpool), amount);
        return wrapper;
    }

    function _processTokenOrWrapperIn(address tokenOrWrapper, uint amount) internal returns(address factToken) {
        address tokenByWrapper = tokenByWrapper[tokenOrWrapper];
        if (tokenByWrapper == address(0)) {
            return _processTokenIn(tokenOrWrapper, amount);
        } else {
            return _processTokenIn(tokenByWrapper, amount);
        }
    }

    function _processTokenOut(address token, uint amount) internal {
        if (amount == 0) {
            return;
        }
        address wrapper = wrapperByToken[token];

        if (wrapper != address(0)) {
            WrappedPiErc20Interface(wrapper).approve(wrapper, amount);
            WrappedPiErc20Interface(wrapper).withdraw(amount);
        }

        require(IERC20(token).transfer(msg.sender, amount), "ERR_TRANSFER_FAILED");
    }

    function _processTokenOutBalance(address token) internal {
        address wrapper = wrapperByToken[token];
        if (wrapper == address(0)) {
            _processTokenOut(token, IERC20(token).balanceOf(address(this)));
        } else {
            _processTokenOut(token, WrappedPiErc20Interface(wrapper).balanceOf(address(this)));
        }
    }

    function _processTokenOrWrapperOutBalance(address tokenOrWrapper) internal {
        address tokenByWrapper = tokenByWrapper[tokenOrWrapper];
        if (tokenByWrapper == address(0)) {
            _processTokenOut(tokenOrWrapper, IERC20(tokenOrWrapper).balanceOf(address(this)));
        } else {
            _processTokenOut(tokenByWrapper, WrappedPiErc20Interface(tokenOrWrapper).balanceOf(address(this)));
        }
    }

    function _getFactToken(address token) internal returns(address) {
        address wrapper = wrapperByToken[token];
        if (wrapper == address(0)) {
            return token;
        } else {
            return wrapper;
        }
    }

    function _setTokenWrapper(address token, address wrapper) internal {
        wrapperByToken[token] = wrapper;
        if (wrapper != address(0)) {
            tokenByWrapper[wrapper] = token;
        }
        emit SetWrapper(token, wrapper);
    }
}
