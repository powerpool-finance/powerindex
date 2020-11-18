// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../PowerIndexAbstractController.sol";
import "../interfaces/PowerIndexWrapperInterface.sol";
import "./WrappedPiErc20.sol";

contract PowerIndexWrappedController is PowerIndexAbstractController {
  event ReplacePoolTokenWithWrapped(
    address indexed existingToken,
    address indexed wrappedToken,
    address indexed router,
    uint256 balance,
    uint256 denormalizedWeight,
    string name,
    string symbol
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

  constructor(address _pool, address _poolWrapper) public PowerIndexAbstractController(_pool) {
    poolWrapper = PowerIndexWrapperInterface(_poolWrapper);
  }

  function setPoolWrapper(address _poolWrapper) external onlyOwner {
    poolWrapper = PowerIndexWrapperInterface(_poolWrapper);
    emit SetPoolWrapper(_poolWrapper);
  }

  function replacePoolTokenWithWrapped(
    address _token,
    address _router,
    string calldata _name,
    string calldata _symbol
  ) external onlyOwner {
    WrappedPiErc20 wrappedToken = new WrappedPiErc20(_token, _router, _name, _symbol);
    uint256 denormalizedWeight = pool.getDenormalizedWeight(_token);
    uint256 balance = pool.getBalance(_token);

    pool.unbind(_token);

    IERC20(_token).approve(address(wrappedToken), balance);
    wrappedToken.deposit(balance);

    wrappedToken.approve(address(pool), balance);
    pool.bind(address(wrappedToken), balance, denormalizedWeight);

    if (address(poolWrapper) != address(0)) {
      poolWrapper.setTokenWrapper(_token, address(wrappedToken));
    }

    emit ReplacePoolTokenWithWrapped(
      _token,
      address(wrappedToken),
      _router,
      balance,
      denormalizedWeight,
      _name,
      _symbol
    );
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
}
