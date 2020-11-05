
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../PiBPoolAbstractController.sol";

contract PiDynamicBPoolController is PiBPoolAbstractController {

    struct DynamicWeightInput {
        address token;
        uint targetDenorm;
        uint fromTimestamp;
        uint targetTimestamp;
    }

    constructor(address _bpool) public PiBPoolAbstractController(_bpool) {

    }

    function setDynamicWeightList(DynamicWeightInput[] memory _dynamicWeights) external onlyOwner {

        uint256 len = _dynamicWeights.length;
        for (uint256 i = 0; i < len; i++) {
            bpool.setDynamicWeight(
                _dynamicWeights[i].token,
                _dynamicWeights[i].targetDenorm,
                _dynamicWeights[i].fromTimestamp,
                _dynamicWeights[i].targetTimestamp
            );
        }
    }

    function unbindNotActualToken(address _token) external {
        require(bpool.getDenormalizedWeight(_token) == bpool.MIN_WEIGHT(), "DENORM_MIN");
        (, uint256 targetTimestamp, , ) = bpool.getDynamicWeightSettings(_token);
        require(block.timestamp > targetTimestamp, "TIMESTAMP_MORE_THEN_TARGET");

        uint256 tokenBalance = bpool.getBalance(_token);

        bpool.unbind(_token);
        (, , , address communityWallet) = bpool.getCommunityFee();
        IERC20(_token).transfer(communityWallet, tokenBalance);
    }
}