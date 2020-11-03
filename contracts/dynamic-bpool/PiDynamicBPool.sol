
pragma solidity 0.6.12;

import "../balancer-core/BPool.sol";
import "@nomiclabs/buidler/console.sol";

contract PiDynamicBPool is BPool {

    struct DynamicWeight {
        uint fromTimestamp;
        uint targetTimestamp;
        uint targetDenorm;
    }

    mapping(address => DynamicWeight) private _dynamicWeights;

    constructor(string memory name, string memory symbol) public BPool(name, symbol) {

    }

    function setDynamicWeight(
        address token,
        uint targetDenorm,
        uint fromTimestamp,
        uint targetTimestamp
    )
        public
        _logs_
        _lock_
    {
        // TODO: check weightPerSecond
        // TODO: check sum of all target weights
        _checkController();

        require(targetTimestamp >= fromTimestamp, "FROM_TO_TARGET_DELTA");

        _records[token].denorm = _getDenormWeight(token);

        _dynamicWeights[token] = DynamicWeight({
            fromTimestamp: fromTimestamp,
            targetTimestamp: targetTimestamp,
            targetDenorm: targetDenorm
        });
    }

    function bind(address token, uint balance, uint denorm, uint targetDenorm, uint fromTimestamp, uint targetTimestamp)
        external
        _logs_
        // _lock_  Bind does not lock because it jumps to `rebind` and `setDynamicWeight`, which does
    {
        super.bind(token, balance, denorm);

        setDynamicWeight(token, targetDenorm, fromTimestamp, targetTimestamp);
    }

    function _getDenormWeight(address token)
        internal view override
        returns (uint)
    {
        DynamicWeight storage dynamicWeight = _dynamicWeights[token];
        if (
            dynamicWeight.fromTimestamp == 0 ||
            dynamicWeight.targetDenorm == _records[token].denorm ||
            block.timestamp <= dynamicWeight.fromTimestamp
        ) {
            return _records[token].denorm;
        }
        if (block.timestamp >= dynamicWeight.targetTimestamp) {
            return dynamicWeight.targetDenorm;
        }

        uint256 deltaTargetTime = bsub(dynamicWeight.targetTimestamp, dynamicWeight.fromTimestamp);
        uint256 deltaCurrentTime = bsub(block.timestamp, dynamicWeight.fromTimestamp);
        uint256 deltaWeight;
        if (dynamicWeight.targetDenorm > _records[token].denorm) {
            deltaWeight = bsub(dynamicWeight.targetDenorm, _records[token].denorm);
            uint256 weightPerSecond = bdiv(deltaWeight, deltaTargetTime);
            return badd(_records[token].denorm, bmul(deltaCurrentTime, weightPerSecond));
        } else {
            deltaWeight = bsub(_records[token].denorm, dynamicWeight.targetDenorm);
            uint256 weightPerSecond = bdiv(deltaWeight, deltaTargetTime);
            return bsub(_records[token].denorm, bmul(deltaCurrentTime, weightPerSecond));
        }
    }

    function _getTotalWeight()
        internal view override
        returns (uint)
    {
        uint256 sum = 0;
        uint256 len = _tokens.length;
        for(uint256 i = 0; i < len; i++) {
            sum = badd(sum, _getDenormWeight(_tokens[i]));
        }
        return sum;
    }

    function getDynamicWeightSettings(address token) external view returns (
        uint fromTimestamp,
        uint targetTimestamp,
        uint fromDenorm,
        uint targetDenorm
    ) {
        DynamicWeight storage dynamicWeight = _dynamicWeights[token];
        return (
            dynamicWeight.fromTimestamp,
            dynamicWeight.targetTimestamp,
            _records[token].denorm,
            dynamicWeight.targetDenorm
        );
    }
}