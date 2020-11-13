// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../powerindex-mining/VestedLPMining.sol";

contract MockVestedLPMiningMath is VestedLPMining {
  uint256 private _mockLptBalance;

  function _setMockParams(uint256 mockLptBalance, uint256 mockTotalAllocPoint) external {
    _mockLptBalance = uint96(mockLptBalance);
    // hacking VestedLPMining::mockTotalAllocPoint
    totalAllocPoint = mockTotalAllocPoint;
  }

  function balanceOf(address account) external view returns (uint256) {
    require(account == address(this), "MockVestedLPMiningMath::balanceOf");
    return _mockLptBalance;
  }

  event _UpdatedUser(
    uint256 newlyEntitled,
    uint256 newlyVested,
    uint256 cvpAdjust,
    uint256 pendedCvp,
    uint32 vestingBlock,
    uint32 lastUpdateBlock
  );

  function __computeCvpVesting(User calldata _user, uint256 _accCvpPerLpt)
    external
    returns (uint256 newlyEntitled, uint256 newlyVested)
  {
    User memory u = _user;

    (newlyEntitled, newlyVested) = super._computeCvpVesting(u, _accCvpPerLpt);

    emit _UpdatedUser(newlyEntitled, newlyVested, u.cvpAdjust, u.pendedCvp, u.vestingBlock, u.lastUpdateBlock);
    return (newlyEntitled, newlyVested);
  }

  event _UpdatedPool(uint32 lastUpdateBlock, uint256 accCvpPerLpt, uint256 cvpReward);

  function __computePoolReward(
    uint32 _allocPoint,
    uint32 _lastUpdateBlock,
    uint256 _accCvpPerLpt
  )
    external
    returns (
      uint32 lastUpdateBlock,
      uint256 accCvpPerLpt,
      uint256 cvpReward
    )
  {
    Pool memory p = Pool(IERC20(address(this)), true, 0x01, _allocPoint, _lastUpdateBlock, _accCvpPerLpt);

    cvpReward = super._computePoolReward(p);

    emit _UpdatedPool(p.lastUpdateBlock, p.accCvpPerLpt, cvpReward);
    return (p.lastUpdateBlock, p.accCvpPerLpt, cvpReward);
  }
}
