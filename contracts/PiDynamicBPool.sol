
pragma solidity 0.6.12;

import "./balancer-core/BPool.sol";

contract PiDynamicBPool is BPool {

    struct DynamicWeight {
        uint fromTimestamp;
        uint targetTimestamp;
        uint targetDenorm;
    }

    mapping(address => DynamicWeight) private _dynamicWeights;

    constructor(string memory name, string memory symbol) public BPool(name, symbol) {

    }

    function setDynamicWeight(address token, uint targetDenorm, uint fromTimestamp, uint targetTimestamp)
        public
        _logs_
        _lock_
    {
        _checkController();

        require(targetTimestamp >= fromTimestamp, "FROM_TO_TARGET_DELTA");

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
        internal view
        returns (uint)
    {
        DynamicWeight dynamicWeight = _dynamicWeights[token];
        if (dynamicWeight.targetTimestamp >= block.time) {
            return dynamicWeight.targetDenorm;
        }
        if (dynamicWeight.fromTimestamp <= block.time) {
            return _records[token].denorm;
        }
        if (dynamicWeight.targetDenorm == _records[token].denorm) {
            return _records[token].denorm;
        }

        uint256 deltaTime = dynamicWeight.targetTimestamp - dynamicWeight.fromTimestamp;
        uint256 deltaWeight;
        if (dynamicWeight.targetDenorm > _records[token].denorm) {
            deltaWeight = dynamicWeight.targetDenorm.sub(_records[token].denorm);
            uint256 weightPerSecond = deltaWeight.div(deltaTime);
            return _records[token].denorm.add(weightPerSecond.mul(deltaTime));
        } else {
            deltaWeight = _records[token].denorm.sub(dynamicWeight.targetDenorm);
            uint256 weightPerSecond = deltaWeight.div(deltaTime);
            return _records[token].denorm.sub(weightPerSecond.mul(deltaTime));
        }
    }

    function _getTotalWeight()
        internal view
        returns (uint)
    {
        uint256 sum = 0;
        uint256 len = _tokens.length;
        for(uint256 i = 0; i < len; i++) {
            sum = sum.add(_getDenormWeight(_tokens[i]));
        }
        return sum;
    }
}