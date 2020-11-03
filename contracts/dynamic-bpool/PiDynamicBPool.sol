
pragma solidity 0.6.12;

import "../balancer-core/BPool.sol";
import "@nomiclabs/buidler/console.sol";

contract PiDynamicBPool is BPool {

    event SetDynamicWeight(
        address indexed token,
        uint fromDenorm,
        uint targetDenorm,
        uint fromTimestamp,
        uint targetTimestamp
    );

    event SetMaxWeightPerSecond(uint maxWeightPerSecond);

    struct DynamicWeight {
        uint fromTimestamp;
        uint targetTimestamp;
        uint targetDenorm;
    }

    mapping(address => DynamicWeight) private _dynamicWeights;

    uint256 private _maxWeightPerSecond;

    constructor(string memory name, string memory symbol, uint maxWeightPerSecond) public BPool(name, symbol) {
        _maxWeightPerSecond = maxWeightPerSecond;
    }

    function setDynamicWeight(uint maxWeightPerSecond)
        public
        _logs_
        _lock_
    {
        _checkController();
        _maxWeightPerSecond = maxWeightPerSecond;

        emit SetMaxWeightPerSecond(maxWeightPerSecond);
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
        _checkController();

        require(targetTimestamp >= fromTimestamp, "TIMESTAMP_NEGATIVE_DELTA");
        require(targetDenorm >= MIN_WEIGHT && targetDenorm <= MAX_WEIGHT, "TARGET_WEIGHT_BOUNDS");

        uint256 fromDenorm = _getDenormWeight(token);
        uint256 weightPerSecond = _getWeightPerSecond(fromDenorm, targetDenorm, fromTimestamp, targetTimestamp);
        require(weightPerSecond <= _maxWeightPerSecond, "MAX_WEIGHT_PER_SECOND");

        uint256 denormSum = 0;
        uint256 len = _tokens.length;
        for (uint256 i = 0; i < len; i++) {
            denormSum = badd(denormSum, _dynamicWeights[_tokens[i]].targetDenorm);
        }

        require(denormSum <= MAX_TOTAL_WEIGHT, "MAX_TARGET_TOTAL_WEIGHT");

        _records[token].denorm = fromDenorm;

        _dynamicWeights[token] = DynamicWeight({
            fromTimestamp: fromTimestamp,
            targetTimestamp: targetTimestamp,
            targetDenorm: targetDenorm
        });

        emit SetDynamicWeight(token, _records[token].denorm, targetDenorm, fromTimestamp, targetTimestamp);
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
        DynamicWeight storage dw = _dynamicWeights[token];
        if (dw.fromTimestamp == 0 || dw.targetDenorm == _records[token].denorm || block.timestamp <= dw.fromTimestamp) {
            return _records[token].denorm;
        }
        if (block.timestamp >= dw.targetTimestamp) {
            return dw.targetDenorm;
        }

        uint256 weightPerSecond = _getWeightPerSecond(
            _records[token].denorm,
            dw.targetDenorm,
            dw.fromTimestamp,
            dw.targetTimestamp
        );
        uint256 deltaCurrentTime = bsub(block.timestamp, dw.fromTimestamp);
        if (dw.targetDenorm > _records[token].denorm) {
            return badd(_records[token].denorm, deltaCurrentTime * weightPerSecond);
        } else {
            return bsub(_records[token].denorm, deltaCurrentTime * weightPerSecond);
        }
    }

    function _getWeightPerSecond(
        uint256 fromDenorm,
        uint256 targetDenorm,
        uint256 fromTimestamp,
        uint256 targetTimestamp
    ) internal view returns (uint) {
        uint256 delta = targetDenorm > fromDenorm ? bsub(targetDenorm, fromDenorm) : bsub(fromDenorm, targetDenorm);
        return delta / bsub(targetTimestamp, fromTimestamp);
    }

    function _getTotalWeight()
        internal view override
        returns (uint)
    {
        uint256 sum = 0;
        uint256 len = _tokens.length;
        for (uint256 i = 0; i < len; i++) {
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
        DynamicWeight storage dw = _dynamicWeights[token];
        return (dw.fromTimestamp, dw.targetTimestamp, _records[token].denorm, dw.targetDenorm);
    }
}