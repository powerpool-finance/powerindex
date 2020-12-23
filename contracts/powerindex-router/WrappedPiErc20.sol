// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/PowerIndexNaiveRouterInterface.sol";
import "../interfaces/PowerIndexBasicRouterInterface.sol";
import "../interfaces/WrappedPiErc20Interface.sol";
import "hardhat/console.sol";

contract WrappedPiErc20 is ERC20, WrappedPiErc20Interface {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 public immutable underlying;
  address public router;

  event Deposit(address indexed account, uint256 undelyingDeposited, uint256 piMinted);
  event Withdraw(address indexed account, uint256 underlyingWithdrawn, uint256 piBurned);
  event Approve(address indexed to, uint256 amount);
  event ChangeRouter(address indexed newRouter);
  event CallExternal(
    address indexed voting,
    bool indexed success,
    bytes4 indexed inputSig,
    bytes inputData,
    bytes outputData
  );

  modifier onlyRouter() {
    require(router == msg.sender, "ONLY_ROUTER");
    _;
  }

  constructor(
    address _token,
    address _router,
    string memory _name,
    string memory _symbol
  ) public ERC20(_name, _symbol) {
    underlying = IERC20(_token);
    router = _router;
  }

  function pokeRouter() external {
    PowerIndexNaiveRouterInterface(router).wrapperCallback(0);
  }

  /**
   * @notice Deposits underlying token to the wrapper
   * @param _depositAmount The amount to deposit in underlying tokens
   */
  function deposit(uint256 _depositAmount) external override {
    require(_depositAmount > 0, "ZERO_DEPOSIT");

    uint256 mintAmount =
      PowerIndexBasicRouterInterface(router).getPiEquivalentFroUnderlying(
        _depositAmount,
        underlying,
        underlying.balanceOf(address(this)),
        IERC20(address(this)).totalSupply()
      );
    require(mintAmount > 0, "ZERO_PI_FOR_MINT");

    underlying.safeTransferFrom(_msgSender(), address(this), _depositAmount);
    _mint(_msgSender(), mintAmount);

    emit Deposit(_msgSender(), _depositAmount, mintAmount);

    PowerIndexNaiveRouterInterface(router).wrapperCallback(0);
  }

  /**
   * @notice Withdraws underlying token from the wrapper
   * @param _withdrawAmount The amount to withdraw in underlying tokens
   */
  function withdraw(uint256 _withdrawAmount) external override {
    require(_withdrawAmount > 0, "ZERO_WITHDRAWAL");

    PowerIndexNaiveRouterInterface(router).wrapperCallback(_withdrawAmount);

    uint256 burnAmount =
      PowerIndexBasicRouterInterface(router).getPiEquivalentFroUnderlying(
        _withdrawAmount,
        underlying,
        underlying.balanceOf(address(this)),
        IERC20(this).totalSupply()
      );
    require(burnAmount > 0, "ZERO_PI_FOR_BURN");

    ERC20(address(this)).transferFrom(_msgSender(), address(this), burnAmount);
    _burn(address(this), burnAmount);
    underlying.safeTransfer(_msgSender(), _withdrawAmount);

    emit Withdraw(_msgSender(), _withdrawAmount, burnAmount);
  }

  function changeRouter(address _newRouter) external override onlyRouter {
    router = _newRouter;
    emit ChangeRouter(router);
  }

  function approveUnderlying(address _to, uint256 _amount) external override onlyRouter {
    underlying.approve(_to, _amount);
    emit Approve(_to, _amount);
  }

  function callExternal(
    address destination,
    bytes4 signature,
    bytes calldata args,
    uint256 value
  ) external override onlyRouter {
    (bool success, bytes memory data) = destination.call{ value: value }(abi.encodePacked(signature, args));
    require(success, string(data));
    //    require(success, "CALL_EXTERNAL_REVERTED");

    emit CallExternal(destination, success, signature, args, data);
  }

  function getUnderlyingBalance() external view override returns (uint256) {
    return underlying.balanceOf(address(this));
  }
}
