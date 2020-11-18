// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/PiRouterInterface.sol";
import "../interfaces/WrappedPiErc20Interface.sol";

contract WrappedPiErc20 is ERC20, WrappedPiErc20Interface {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  IERC20 public immutable token;
  address public router;

  event Deposit(address indexed account, uint256 amount);
  event Withdraw(address indexed account, uint256 amount);
  event Approve(address indexed to, uint256 amount);
  event ChangeRouter(address indexed newRouter);
  event CallVoting(
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
    token = IERC20(_token);
    router = _router;
  }

  function pokeRouter() external {
    PiRouterInterface(router).wrapperCallback(0);
  }

  function deposit(uint256 _amount) external override {
    require(_amount > 0, "ZERO_DEPOSIT");

    emit Deposit(_msgSender(), _amount);

    token.safeTransferFrom(_msgSender(), address(this), _amount);
    _mint(_msgSender(), _amount);

    PiRouterInterface(router).wrapperCallback(0);
  }

  function withdraw(uint256 _amount) external override {
    require(_amount > 0, "ZERO_WITHDRAWAL");

    emit Withdraw(_msgSender(), _amount);

    PiRouterInterface(router).wrapperCallback(_amount);

    ERC20(address(this)).transferFrom(_msgSender(), address(this), _amount);
    _burn(address(this), _amount);
    token.safeTransfer(_msgSender(), _amount);
  }

  function changeRouter(address _newRouter) external override onlyRouter {
    router = _newRouter;
    emit ChangeRouter(router);
  }

  function approveToken(address _to, uint256 _amount) external override onlyRouter {
    token.approve(_to, _amount);
    emit Approve(_to, _amount);
  }

  function callVoting(
    address voting,
    bytes4 signature,
    bytes calldata args,
    uint256 value
  ) external override onlyRouter {
    (bool success, bytes memory data) = voting.call{ value: value }(abi.encodePacked(signature, args));
    require(success, "CALL_VOTING_REVERTED");

    emit CallVoting(voting, success, signature, args, data);
  }

  function getWrappedBalance() external view override returns (uint256) {
    return token.balanceOf(address(this));
  }
}
