pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;


import "../VestedLPMining.sol";


contract MockVestedLPMining is VestedLPMining {

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

    event UpdatedUser(
        uint256 cvpAdjust, uint256 entitledCvp, uint256 vestedCvp, uint32 vestingBlock, uint32 lastUpdateBlock
    );
    function _computeCvpVesting(
        uint256 lptAmount,
        uint256 cvpAdjust,
        uint256 entitledCvp,
        uint256 vestedCvp,
        uint32 vestingBlock,
        uint32 lastUpdateBlock,
        uint256 accCvpPerLpt
    ) external {
        User memory u = User(lptAmount, cvpAdjust, entitledCvp, vestedCvp, vestingBlock, lastUpdateBlock);
        super.computeCvpVesting(u, accCvpPerLpt);
        emit UpdatedUser(u.cvpAdjust, u.entitledCvp, u.vestedCvp, u.vestingBlock, u.lastUpdateBlock);
    }

    event UpdatedPool(
        uint32 lastUpdateBlock, uint256 accCvpPerLpt, uint256 cvpBalance
    );
    function _computePoolReward(
        uint256 mockLptBalance,
        uint256 mockTotalAllocPoint,
        uint32 allocPoint,
        uint32 lastUpdateBlock,
        uint256 accCvpPerLpt,
        uint256 cvpBalance
    ) external {
        Pool memory p = Pool(IERC20(address(this)), true, 0x01, allocPoint, lastUpdateBlock, accCvpPerLpt, cvpBalance);

        // Assigning CVP mock "balance" (hacking Checkpoints::balanceOf)
        uint96 savedBalance = balances[address(this)];
        balances[address(this)] = uint96(mockLptBalance);
        // .. and moc "totalAllocPoint" (hacking VestedLPMining::mockTotalAllocPoint)
        uint256 savedTotalAllocPoint = totalAllocPoint;
        totalAllocPoint = mockTotalAllocPoint;

        super.computePoolReward(p);
        emit UpdatedPool(p.lastUpdateBlock, p.accCvpPerLpt, p.cvpBalance);

        balances[address(this)] = savedBalance;
        totalAllocPoint = savedTotalAllocPoint;
    }
}
