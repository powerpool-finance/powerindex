pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;


import "../VestedLPMining.sol";


contract MockVestedLPMiningMath is VestedLPMining {

    uint256 private _mockLptBalance;

    constructor(
        IERC20 _cvp,
        address _reservoir,
        uint256 _cvpPerBlock,
        uint256 _startBlock,
        uint256 _cvpVestingPeriodInBlocks
    ) public
    VestedLPMining(_cvp, _reservoir, _cvpPerBlock, _startBlock, _cvpVestingPeriodInBlocks)
    {
    }

    function _setMockParams(uint256 mockLptBalance, uint256 mockTotalAllocPoint) external
    {
        // Assigning CVP mock "balance" (hacking Checkpoints::balanceOf)
        balances[address(this)] = uint96(mockLptBalance);
        // .. and moc "totalAllocPoint" (hacking VestedLPMining::mockTotalAllocPoint)
        totalAllocPoint = mockTotalAllocPoint;
    }

    event _UpdatedUser(
        uint256 newlyEntitled,
        uint256 newlyVested,
        uint256 cvpAdjust,
        uint256 entitledCvp,
        uint256 vestedCvp,
        uint32 vestingBlock,
        uint32 lastUpdateBlock
    );

    function _computeCvpVesting(User calldata _user, uint256 _accCvpPerLpt) external returns (uint256 newlyEntitled, uint256 newlyVested)
    {
        User memory u = _user;

        (newlyEntitled, newlyVested) = super.computeCvpVesting(u, _accCvpPerLpt);

        emit _UpdatedUser(newlyEntitled, newlyVested, u.cvpAdjust, u.entitledCvp, u.vestedCvp, u.vestingBlock, u.lastUpdateBlock);
        return (newlyEntitled, newlyVested);
    }

    event _UpdatedPool(
        uint32 lastUpdateBlock, uint256 accCvpPerLpt, uint256 cvpReward
    );

    function _computePoolReward(
        uint32 _allocPoint,
        uint32 _lastUpdateBlock,
        uint256 _accCvpPerLpt
    ) external returns (
        uint32 lastUpdateBlock,
        uint256 accCvpPerLpt,
        uint256 cvpReward
    ) {
        Pool memory p = Pool(
            IERC20(address(this)), true, 0x01, _allocPoint, _lastUpdateBlock, _accCvpPerLpt
        );

        cvpReward = super.computePoolReward(p);

        emit _UpdatedPool(p.lastUpdateBlock, p.accCvpPerLpt, cvpReward);
        return (p.lastUpdateBlock, p.accCvpPerLpt, cvpReward);
    }
}
