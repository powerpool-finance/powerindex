// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../PowerIndexAbstractController.sol";
import "../interfaces/PowerIndexWrapperInterface.sol";
import "../interfaces/WrappedPiErc20FactoryInterface.sol";
import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/IPiRouterFactory.sol";

contract PowerIndexWrappedController is PowerIndexAbstractController {
  event ReplacePoolTokenWithWrapped(
    address indexed existingToken,
    address indexed wrappedToken,
    uint256 balance,
    uint256 denormalizedWeight
  );

  event ReplacePoolTokenWithNewVersion(
    address indexed oldToken,
    address indexed newToken,
    address indexed migrator,
    uint256 balance,
    uint256 denormalizedWeight
  );

  event SetPoolWrapper(address indexed bpoolWrapper);

  PowerIndexWrapperInterface public poolWrapper;
  WrappedPiErc20FactoryInterface public wrapperFactory;

  constructor(
    address _pool,
    address _poolWrapper,
    address _wrapperFactory
  ) public PowerIndexAbstractController(_pool) {
    poolWrapper = PowerIndexWrapperInterface(_poolWrapper);
    wrapperFactory = WrappedPiErc20FactoryInterface(_wrapperFactory);
  }

  function setPoolWrapper(address _poolWrapper) external onlyOwner {
    poolWrapper = PowerIndexWrapperInterface(_poolWrapper);
    emit SetPoolWrapper(_poolWrapper);
  }

  function replacePoolTokenWithNewWrapped(
    address _token,
    address _routerFactory,
    address _poolRestrictions,
    string calldata _name,
    string calldata _symbol
  ) external onlyOwner {
    WrappedPiErc20Interface wrappedToken = wrapperFactory.build(_token, address(this), _name, _symbol);
    address router = IPiRouterFactory(_routerFactory).buildRouter(address(wrappedToken), _poolRestrictions);
    wrappedToken.changeRouter(router);
    _replacePoolTokenWithWrapped(_token, wrappedToken);
  }

  function replacePoolTokenWithExistsWrapped(address _token, WrappedPiErc20Interface _wrappedToken) external onlyOwner {
    _replacePoolTokenWithWrapped(_token, _wrappedToken);
  }

  function replacePoolTokenWithNewVersion(
    address _oldToken,
    address _newToken,
    address _migrator,
    bytes calldata _migratorData
  ) external onlyOwner {
    uint256 denormalizedWeight = pool.getDenormalizedWeight(_oldToken);
    uint256 balance = pool.getBalance(_oldToken);

    pool.unbind(_oldToken);

    IERC20(_oldToken).approve(_migrator, balance);
    (bool success, ) = _migrator.call(_migratorData);
    require(success, "NOT_SUCCESS");

    require(
      IERC20(_newToken).balanceOf(address(this)) >= balance,
      "PiBPoolController:newVersion: insufficient newToken balance"
    );

    IERC20(_newToken).approve(address(pool), balance);
    pool.bind(_newToken, balance, denormalizedWeight);

    emit ReplacePoolTokenWithNewVersion(_oldToken, _newToken, _migrator, balance, denormalizedWeight);
  }

  function _replacePoolTokenWithWrapped(address _token, WrappedPiErc20Interface _wrappedToken) internal {
    uint256 denormalizedWeight = pool.getDenormalizedWeight(_token);
    uint256 balance = pool.getBalance(_token);

    pool.unbind(_token);

    IERC20(_token).approve(address(_wrappedToken), balance);
    _wrappedToken.deposit(balance);

    _wrappedToken.approve(address(pool), balance);
    pool.bind(address(_wrappedToken), balance, denormalizedWeight);

    if (address(poolWrapper) != address(0)) {
      poolWrapper.setTokenWrapper(_token, address(_wrappedToken));
    }

    emit ReplacePoolTokenWithWrapped(_token, address(_wrappedToken), balance, denormalizedWeight);
  }
}
