// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./PowerIndexPoolController.sol";

contract PiptController is PowerIndexPoolController {
  /** @dev Last maxWeightPerSecond setting of PowerIndexPool. */
  uint256 public lastMaxWeightPerSecond;
  /** @dev Last wrapperMode setting of PowerIndexPool. */
  bool public lastWrapperMode;
  /** @dev Timestamp, when possible to call finishReplace. */
  uint256 public replaceFinishTimestamp;

  constructor(
    address _pool,
    address _poolWrapper,
    address _wrapperFactory,
    address _weightsStrategy
  ) public PowerIndexPoolController(_pool, _poolWrapper, _wrapperFactory, _weightsStrategy) {}

  function _bindNewToken(
    address _piToken,
    uint256 _balance,
    uint256 _denormalizedWeight
  ) internal override {
    _initiateReplace(_denormalizedWeight);

    pool.bind(address(_piToken), _balance, _denormalizedWeight, block.timestamp + 1, replaceFinishTimestamp);
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
}
