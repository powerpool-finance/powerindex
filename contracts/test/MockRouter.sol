// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../powerindex-router/PowerIndexBasicRouter.sol";
import "../powerindex-router/WrappedPiErc20.sol";

contract MockRouter is PowerIndexBasicRouter {
  event MockWrapperCallback(uint256 withdrawAmount);

  address public underlying;
  address public mockStaking;

  constructor(address _piToken, BasicConfig memory _basicConfig) public PowerIndexBasicRouter(_piToken, _basicConfig) {}

  function _claimRewards(ReserveStatus _reserveStatus) internal override {
    // do nothing
  }

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 sushiDiff) internal override {
    // do nothing
  }

  function _getUnderlyingReserve() internal view override returns (uint256) {
    return 0;
  }

  function setMockStaking(address _underlying, address _mockStaking) external {
    underlying = _underlying;
    mockStaking = _mockStaking;
  }

  function _getUnderlyingStaked() internal view override returns (uint256) {
    return 0;
  }

  function piTokenCallback(address sender, uint256 _withdrawAmount) external payable virtual override {
    emit MockWrapperCallback(_withdrawAmount);
  }

  function execute(address destination, bytes calldata data) external {
    destination.call(data);
  }

  function drip(address _to, uint256 _amount) external {
    piToken.callExternal(
      address(WrappedPiErc20(address(piToken)).underlying()),
      IERC20(0).transfer.selector,
      abi.encode(_to, _amount),
      0
    );
  }
}
