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

  event ReplacePoolTokenFinish();

  event SetPoolWrapper(address indexed bpoolWrapper);
  event CreateWrappedToken(address indexed token, address indexed wrappedToken);

  PowerIndexWrapperInterface public poolWrapper;
  WrappedPiErc20FactoryInterface public wrapperFactory;

  uint256 lastMaxWeightPerSecond;
  bool lastWrapperMode;
  uint256 replaceFinishTimestamp;

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

  function createWrappedToken(
    address _token,
    address _routerFactory,
    address _poolRestrictions,
    string calldata _name,
    string calldata _symbol
  ) external onlyOwner {
    WrappedPiErc20Interface wrappedToken =
      _createWrappedToken(_token, _routerFactory, _poolRestrictions, _name, _symbol);
    emit CreateWrappedToken(_token, address(wrappedToken));
  }

  function replacePoolTokenWithNewWrapped(
    address _token,
    address _routerFactory,
    address _poolRestrictions,
    string calldata _name,
    string calldata _symbol
  ) external onlyOwner {
    WrappedPiErc20Interface wrappedToken =
      _createWrappedToken(_token, _routerFactory, _poolRestrictions, _name, _symbol);
    _replacePoolTokenWithWrapped(_token, wrappedToken);
  }

  function replacePoolTokenWithExistingWrapped(address _token, WrappedPiErc20Interface _wrappedToken)
    external
    onlyOwner
  {
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

    _initiateReplace(denormalizedWeight);

    pool.bind(_newToken, balance, denormalizedWeight, block.timestamp + 1, replaceFinishTimestamp);

    emit ReplacePoolTokenWithNewVersion(_oldToken, _newToken, _migrator, balance, denormalizedWeight);
  }

  function _replacePoolTokenWithWrapped(address _token, WrappedPiErc20Interface _wrappedToken) internal {
    uint256 denormalizedWeight = pool.getDenormalizedWeight(_token);
    uint256 balance = pool.getBalance(_token);

    pool.unbind(_token);

    IERC20(_token).approve(address(_wrappedToken), balance);
    _wrappedToken.deposit(balance);

    _wrappedToken.approve(address(pool), balance);

    _initiateReplace(denormalizedWeight);

    pool.bind(address(_wrappedToken), balance, denormalizedWeight, block.timestamp + 1, replaceFinishTimestamp);

    if (address(poolWrapper) != address(0)) {
      poolWrapper.setTokenWrapper(_token, address(_wrappedToken));
    }

    emit ReplacePoolTokenWithWrapped(_token, address(_wrappedToken), balance, denormalizedWeight);
  }

  function _initiateReplace(uint256 denormalizedWeight) internal {
    require(replaceFinishTimestamp == 0, "REPLACE_ALREADY_INITIATED");

    (uint256 minWeightPerSecond, uint256 maxWeightPerSecond) = pool.getWeightPerSecondBounds();
    lastMaxWeightPerSecond = maxWeightPerSecond;
    lastWrapperMode = pool.getWrapperMode();

    replaceFinishTimestamp = block.timestamp + denormalizedWeight.div(1 ether) + 10;

    pool.setWeightPerSecondBounds(minWeightPerSecond, uint256(1 ether));
    pool.setWrapper(0x0000000000000000000000000000000000000000, true);
  }

  function finishReplace() external {
    require(replaceFinishTimestamp != 0, "REPLACE_NOT_INITIATED");
    require(block.timestamp > replaceFinishTimestamp, "TOO_SOON");

    (uint256 minWeightPerSecond, ) = pool.getWeightPerSecondBounds();
    pool.setWeightPerSecondBounds(minWeightPerSecond, lastMaxWeightPerSecond);

    replaceFinishTimestamp = 0;

    pool.setWrapper(address(poolWrapper), lastWrapperMode);

    emit ReplacePoolTokenFinish();
  }

  function _createWrappedToken(
    address _token,
    address _routerFactory,
    address _poolRestrictions,
    string calldata _name,
    string calldata _symbol
  ) internal returns (WrappedPiErc20Interface) {
    WrappedPiErc20Interface wrappedToken = wrapperFactory.build(_token, address(this), _name, _symbol);
    address router = IPiRouterFactory(_routerFactory).buildRouter(address(wrappedToken), _poolRestrictions);
    Ownable(router).transferOwnership(msg.sender);
    wrappedToken.changeRouter(router);
    return wrappedToken;
  }
}
