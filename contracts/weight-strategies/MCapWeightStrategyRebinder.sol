// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./MCapWeightAbstract.sol";
import "../PowerIndexPoolController.sol";

contract MCapWeightStrategyRebinder is MCapWeightAbstract {
  event SetOperationsContract(address indexed operationsContract);
  event ExecuteOperation(address indexed operationsContract, bool indexed success, bytes inData, bytes outData);

  struct RebindOperation {
    address token;
    uint256 newWeight;
    uint256 oldBalance;
    uint256 newBalance;
    uint256 opApproveAmount;
    address opToken;
    bytes opData;
    bool opAfter;
  }
  struct RebindConfig {
    address token;
    uint256 newWeight;
    uint256 oldBalance;
    uint256 newBalance;
  }

  address public operationsContract;

  constructor(address _oracle, address _operationsContract) public OwnableUpgradeSafe() {
    __Ownable_init();
    oracle = IPowerOracle(_oracle);
    operationsContract = _operationsContract;
    totalWeight = 25 * BONE;
  }

  function setOperationsContract(address _operationsContract) public onlyOwner {
    operationsContract = _operationsContract;

    emit SetOperationsContract(_operationsContract);
  }

  function setController(PowerIndexPoolInterface _pool, address _newController) public onlyOwner {
    _pool.setController(_newController);
  }

  function runRebind(
    PowerIndexPoolInterface _pool,
    address _newController,
    RebindOperation[] memory _ops
  ) public onlyOwner {
    address[] memory tokens = _pool.getCurrentTokens();
    uint256 len = _ops.length;

    for (uint256 i = 0; i < len; i++) {
      if (!_ops[i].opAfter) {
        _runOperation(_ops[i]);
      }

      if (_ops[i].token != address(0)) {
        if (_ops[i].newBalance > _ops[i].oldBalance) {
          _ops[i].oldBalance = _pool.getBalance(_ops[i].token);
          uint256 amountToAdd = IERC20(_ops[i].token).balanceOf(address(this));
          IERC20(_ops[i].token).approve(address(_pool), amountToAdd);
          _pool.rebind(_ops[i].token, _ops[i].oldBalance + amountToAdd, _ops[i].newWeight);
        } else {
          _pool.rebind(_ops[i].token, _ops[i].newBalance, _ops[i].newWeight);
        }
      }

      if (_ops[i].opAfter) {
        _runOperation(_ops[i]);
      }
    }
  }

  function _runOperation(RebindOperation memory _op) internal {
    if (_op.opToken != address(0)) {
      if (_op.opApproveAmount != 0) {
        IERC20(_op.opToken).approve(operationsContract, _op.opApproveAmount);
      }
      (bool success, bytes memory resData) = operationsContract.call(_op.opData);
      require(success, "NOT_SUCCESS");
      emit ExecuteOperation(operationsContract, success, _op.opData, resData);
    }
  }

  function getRebindConfigs(
    PowerIndexPoolInterface _pool,
    address[] memory _tokens,
    uint256 _oldWeightDiv
  ) external view returns (RebindConfig[] memory configs) {
    uint256 len = _tokens.length;
    uint256[] memory oldBalances = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      oldBalances[i] = IERC20(_tokens[i]).balanceOf(address(_pool));
    }

    uint256 now = block.timestamp;
    (uint256[3][] memory weightsChange, , ) =
      computeWeightsChange(_pool, _tokens, new address[](0), 0, 100 ether, now, now + 1);

    configs = new RebindConfig[](len);
    for (uint256 i = 0; i < len; i++) {
      uint256[3] memory wc = weightsChange[i];
      uint256 ti = wc[0];
      uint256 oldWeight = wc[1] / _oldWeightDiv;
      uint256 newWeight = wc[2];
      configs[i] = RebindConfig(
        _tokens[ti],
        newWeight,
        oldBalances[ti],
        bmul(oldBalances[ti], bdiv(newWeight, oldWeight))
      );
    }
  }
}
