// SPDX-License-Identifier: MIT

pragma experimental ABIEncoderV2;
pragma solidity 0.6.12;

import "../powerindex-router/PowerIndexBasicRouter.sol";

contract MockPowerIndexBasicRouter is PowerIndexBasicRouter {
  uint256 piRate;

  constructor(address _piToken, BasicConfig memory _basicConfig) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    piRate = 1 ether;
  }

  function _claimRewards(ReserveStatus _reserveStatus) internal override {
    // do nothing
  }

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 sushiDiff) internal override {
    // do nothing
  }

  function _getUnderlyingReserve() internal view override returns (uint256) {
    return 0;
  }

  function mockSetRate(uint256 _piRate) public {
    piRate = _piRate;
  }

  function getUnderlyingEquivalentForPi(
    uint256 _underlyingAmount,
    IERC20,
    uint256
  ) public view override returns (uint256) {
    return _underlyingAmount.mul(piRate).div(uint256(1 ether));
  }

  function getPiEquivalentForUnderlying(
    uint256 _piAmount,
    IERC20,
    uint256
  ) public view override returns (uint256) {
    return _piAmount.mul(uint256(1 ether)).div(piRate);
  }
}
