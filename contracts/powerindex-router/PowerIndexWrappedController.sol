// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../PowerIndexAbstractController.sol";
import "../interfaces/PowerIndexWrapperInterface.sol";
import "../interfaces/WrappedPiErc20FactoryInterface.sol";
import "../interfaces/WrappedPiErc20Interface.sol";
import "../interfaces/IPiRouterFactory.sol";

contract PowerIndexWrappedController is PowerIndexAbstractController {
  /* ==========  EVENTS  ========== */

  /** @dev Emitted on replacing underlying token with exists piToken. */
  event ReplacePoolTokenWithPiToken(
    address indexed underlyingToken,
    address indexed piToken,
    uint256 balance,
    uint256 denormalizedWeight
  );

  /** @dev Emitted on replacing underlying token with new version of token. */
  event ReplacePoolTokenWithNewVersion(
    address indexed oldToken,
    address indexed newToken,
    address indexed migrator,
    uint256 balance,
    uint256 denormalizedWeight
  );

  /** @dev Emitted on finishing pool replacing. */
  event ReplacePoolTokenFinish();

  /** @dev Emitted on bpoolWrapper update. */
  event SetPoolWrapper(address indexed bpoolWrapper);

  /** @dev Emitted on creating piToken. */
  event CreatePiToken(address indexed underlyingToken, address indexed piToken, address indexed router);

  /* ==========  Storage  ========== */

  /** @dev Address of poolWrapper contract. */
  PowerIndexWrapperInterface public poolWrapper;

  /** @dev Address of piToken factory contract. */
  WrappedPiErc20FactoryInterface public piTokenFactory;

  /** @dev Last maxWeightPerSecond setting of PowerIndexPool. */
  uint256 public lastMaxWeightPerSecond;
  /** @dev Last wrapperMode setting of PowerIndexPool. */
  bool public lastWrapperMode;
  /** @dev Timestamp, when possible to call finishReplace. */
  uint256 public replaceFinishTimestamp;

  constructor(
    address _pool,
    address _poolWrapper,
    address _piTokenFactory
  ) public PowerIndexAbstractController(_pool) {
    poolWrapper = PowerIndexWrapperInterface(_poolWrapper);
    piTokenFactory = WrappedPiErc20FactoryInterface(_piTokenFactory);
  }

  /**
   * @dev Set poolWrapper contract address.
   * @param _poolWrapper Address of pool wrapper.
   */
  function setPoolWrapper(address _poolWrapper) external onlyOwner {
    poolWrapper = PowerIndexWrapperInterface(_poolWrapper);
    emit SetPoolWrapper(_poolWrapper);
  }

  /**
   * @dev Creating piToken using underling token and router factory.
   * @param _underlyingToken Token, which will be wrapped by piToken.
   * @param _routerFactory Router factory, to creating router by buildRouter function.
   * @param _routerArgs Router args, depends on router implementation.
   * @param _name Name of piToken.
   * @param _name Symbol of piToken.
   */
  function createPiToken(
    address _underlyingToken,
    address _routerFactory,
    bytes memory _routerArgs,
    string calldata _name,
    string calldata _symbol
  ) external onlyOwner {
    _createPiToken(_underlyingToken, _routerFactory, _routerArgs, _name, _symbol);
  }

  /**
   * @dev Creating piToken and replacing pool token with it.
   * @param _underlyingToken Token, which will be wrapped by piToken.
   * @param _routerFactory Router factory, to creating router by buildRouter function.
   * @param _routerArgs Router args, depends on router implementation.
   * @param _name Name of piToken.
   * @param _name Symbol of piToken.
   */
  function replacePoolTokenWithNewPiToken(
    address _underlyingToken,
    address _routerFactory,
    bytes calldata _routerArgs,
    string calldata _name,
    string calldata _symbol
  ) external payable onlyOwner {
    WrappedPiErc20Interface piToken = _createPiToken(_underlyingToken, _routerFactory, _routerArgs, _name, _symbol);
    _replacePoolTokenWithPiToken(_underlyingToken, piToken);
  }

  /**
   * @dev Replacing pool token with existing piToken.
   * @param _underlyingToken Token, which will be wrapped by piToken.
   * @param _piToken Address of piToken.
   */
  function replacePoolTokenWithExistingPiToken(address _underlyingToken, WrappedPiErc20Interface _piToken)
    external
    payable
    onlyOwner
  {
    _replacePoolTokenWithPiToken(_underlyingToken, _piToken);
  }

  /**
   * @dev Replacing pool token with new token version and calling migrator.
   * Warning! All balance of poll token will be approved to _migrator for exchange to new token.
   *
   * @param _oldToken Pool token ti replace with new version.
   * @param _newToken New version of token to bind to pool instead of the old.
   * @param _migrator Address of contract to migrate from old token to new. Do not use untrusted contract!
   * @param _migratorData Data for executing migrator.
   */
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

  /*** Permission-less Functions ***/

  /**
   * @dev Finishing initiated token replacing.
   */
  function finishReplace() external {
    require(replaceFinishTimestamp != 0, "REPLACE_NOT_INITIATED");
    require(block.timestamp > replaceFinishTimestamp, "TOO_SOON");

    (uint256 minWeightPerSecond, ) = pool.getWeightPerSecondBounds();
    pool.setWeightPerSecondBounds(minWeightPerSecond, lastMaxWeightPerSecond);

    replaceFinishTimestamp = 0;

    pool.setWrapper(address(poolWrapper), lastWrapperMode);

    emit ReplacePoolTokenFinish();
  }

  /*** Internal Functions ***/

  function _replacePoolTokenWithPiToken(address _underlyingToken, WrappedPiErc20Interface _piToken) internal {
    uint256 denormalizedWeight = pool.getDenormalizedWeight(_underlyingToken);
    uint256 balance = pool.getBalance(_underlyingToken);

    pool.unbind(_underlyingToken);

    IERC20(_underlyingToken).approve(address(_piToken), balance);
    _piToken.deposit{ value: msg.value }(balance);

    _piToken.approve(address(pool), balance);

    _initiateReplace(denormalizedWeight);

    pool.bind(address(_piToken), balance, denormalizedWeight, block.timestamp + 1, replaceFinishTimestamp);

    if (address(poolWrapper) != address(0)) {
      poolWrapper.setPiTokenForUnderlying(_underlyingToken, address(_piToken));
    }

    emit ReplacePoolTokenWithPiToken(_underlyingToken, address(_piToken), balance, denormalizedWeight);
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

  function _createPiToken(
    address _underlyingToken,
    address _routerFactory,
    bytes memory _routerArgs,
    string calldata _name,
    string calldata _symbol
  ) internal returns (WrappedPiErc20Interface) {
    WrappedPiErc20Interface piToken = piTokenFactory.build(_underlyingToken, address(this), _name, _symbol);
    address router = IPiRouterFactory(_routerFactory).buildRouter(address(piToken), _routerArgs);
    Ownable(router).transferOwnership(msg.sender);
    piToken.changeRouter(router);

    emit CreatePiToken(_underlyingToken, address(piToken), router);
    return piToken;
  }
}
