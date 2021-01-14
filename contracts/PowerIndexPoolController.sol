// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./powerindex-router/PowerIndexWrappedController.sol";

contract PowerIndexPoolController is PowerIndexWrappedController {
  using SafeERC20 for IERC20;

  /* ==========  Storage  ========== */

  /** @dev Signature to execute bind of pool. */
  bytes4 public constant BIND_SIG = bytes4(keccak256(bytes("bind(address,uint256,uint256,uint256,uint256)")));

  /** @dev Signature to execute unbind of pool. */
  bytes4 public constant UNBIND_SIG = bytes4(keccak256(bytes("unbind(address)")));

  struct DynamicWeightInput {
    address token;
    uint256 targetDenorm;
    uint256 fromTimestamp;
    uint256 targetTimestamp;
  }

  constructor(
    address _pool,
    address _poolWrapper,
    address _wrapperFactory
  ) public PowerIndexWrappedController(_pool, _poolWrapper, _wrapperFactory) {}

  /* ==========  Configuration Actions  ========== */

  /**
   * @notice Call bind of pool
   * @param token Token for bind
   * @param balance Initial balance
   * @param targetDenorm Target weight
   * @param fromTimestamp From timestamp of dynamic weight
   * @param targetTimestamp Target timestamp of dynamic weight
   */
  function bind(
    address token,
    uint256 balance,
    uint256 targetDenorm,
    uint256 fromTimestamp,
    uint256 targetTimestamp
  ) external onlyOwner {
    _validateNewTokenBind();

    IERC20(token).safeTransferFrom(msg.sender, address(this), balance);
    IERC20(token).approve(address(pool), balance);
    pool.bind(token, balance, targetDenorm, fromTimestamp, targetTimestamp);
  }

  /**
   * @notice Set target weight of old token to MIN_WEIGHT and add new token with previous weight of old token
   * @param oldToken Token to replace
   * @param newToken New token
   * @param balance Initial new token balance
   * @param fromTimestamp From timestamp of dynamic weight
   * @param targetTimestamp Target timestamp of dynamic weight
   */
  function replaceTokenWithNew(
    address oldToken,
    address newToken,
    uint256 balance,
    uint256 fromTimestamp,
    uint256 targetTimestamp
  ) external onlyOwner {
    _replaceTokenWithNew(oldToken, newToken, balance, fromTimestamp, targetTimestamp);
  }

  /**
   * @notice The same as replaceTokenWithNew, but sets fromTimestamp with block.timestamp
              and uses durationFromNow to set targetTimestamp
   * @param oldToken Token to replace
   * @param newToken New token
   * @param balance Initial new token balance
   * @param durationFromNow Duration for set targetTimestamp by sum with block.timestamp
   */
  function replaceTokenWithNewFromNow(
    address oldToken,
    address newToken,
    uint256 balance,
    uint256 durationFromNow
  ) external onlyOwner {
    uint256 now = block.timestamp.add(1);
    _replaceTokenWithNew(oldToken, newToken, balance, now, now.add(durationFromNow));
  }

  /**
   * @notice Call setDynamicWeight for several tokens
   * @param _dynamicWeights Tokens dynamic weights configs
   */
  function setDynamicWeightList(DynamicWeightInput[] memory _dynamicWeights) external onlyOwner {
    uint256 len = _dynamicWeights.length;
    for (uint256 i = 0; i < len; i++) {
      pool.setDynamicWeight(
        _dynamicWeights[i].token,
        _dynamicWeights[i].targetDenorm,
        _dynamicWeights[i].fromTimestamp,
        _dynamicWeights[i].targetTimestamp
      );
    }
  }

  /**
   * @notice Permissionless function for unbind tokens which has reached MIN_WEIGHT
   * @param _token Token to unbind
   */
  function unbindNotActualToken(address _token) external {
    require(pool.getDenormalizedWeight(_token) == pool.getMinWeight(), "DENORM_MIN");
    (, uint256 targetTimestamp, , ) = pool.getDynamicWeightSettings(_token);
    require(block.timestamp > targetTimestamp, "TIMESTAMP_MORE_THEN_TARGET");

    uint256 tokenBalance = pool.getBalance(_token);

    pool.unbind(_token);
    (, , , address communityWallet) = pool.getCommunityFee();
    IERC20(_token).safeTransfer(communityWallet, tokenBalance);
  }

  function _checkSignature(bytes4 signature) internal pure override {
    require(signature != BIND_SIG && signature != UNBIND_SIG && signature != CALL_VOTING_SIG, "SIGNATURE_NOT_ALLOWED");
  }

  /*** Internal Functions ***/

  /**
   * @notice Set target weight of old token to MIN_WEIGHT and add new token with previous weight of old token
   * @param oldToken Token to replace
   * @param newToken New token
   * @param balance Initial new token balance
   * @param fromTimestamp From timestamp of dynamic weight
   * @param targetTimestamp Target timestamp of dynamic weight
   */
  function _replaceTokenWithNew(
    address oldToken,
    address newToken,
    uint256 balance,
    uint256 fromTimestamp,
    uint256 targetTimestamp
  ) internal {
    uint256 minWeight = pool.getMinWeight();
    (, , , uint256 targetDenorm) = pool.getDynamicWeightSettings(oldToken);

    pool.setDynamicWeight(oldToken, minWeight, fromTimestamp, targetTimestamp);

    IERC20(newToken).safeTransferFrom(msg.sender, address(this), balance);
    IERC20(newToken).approve(address(pool), balance);
    pool.bind(newToken, balance, targetDenorm.sub(minWeight), fromTimestamp, targetTimestamp);
  }

  /**
   * @notice Checking that pool doesn't maximum number or it have the pool with target weight equals min weight
   */
  function _validateNewTokenBind() internal {
    address[] memory tokens = pool.getCurrentTokens();
    uint256 tokensLen = tokens.length;
    uint256 minWeight = pool.getMinWeight();

    if (tokensLen == pool.getMaxBoundTokens() - 1) {
      for (uint256 i = 0; i < tokensLen; i++) {
        (, , , uint256 targetDenorm) = pool.getDynamicWeightSettings(tokens[i]);
        if (targetDenorm == minWeight) {
          return;
        }
      }
      revert("NEW_TOKEN_NOT_ALLOWED"); // If there is no tokens with target MIN_WEIGHT
    }
  }
}
