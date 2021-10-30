// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../PowerIndexBasicRouter.sol";
import "../../interfaces/venus/VenusComptrollerInterface.sol";
import "../../interfaces/venus/VBep20Interface.sol";

/**
 * @notice PowerIndex Router for Venus protocol.
 * @dev The router designed to work with XVS token only (XVS == UNDERLYING).
 *      Can support other tokens as underlying with further modifications.
 * @dev Venus rewards in XVS token can be either claimed manually by calling `Comptroller.claimVenus()`
 */
contract VenusVBep20SupplyRouter is PowerIndexBasicRouter {
  event Stake(address indexed sender, uint256 amount);
  event Redeem(address indexed sender, uint256 amount);
  event IgnoreDueMissingStaking();
  event ClaimRewards(address indexed sender, uint256 xvsEarned);

  struct VenusConfig {
    address troller;
    address xvs;
  }

  uint256 internal constant NO_ERROR_CODE = 0;

  address internal immutable TROLLER;
  IERC20 internal immutable UNDERLYING;
  IERC20 internal immutable XVS;
  uint256 lastStakedAmount;

  constructor(
    address _piToken,
    BasicConfig memory _basicConfig,
    VenusConfig memory _compConfig
  ) public PowerIndexBasicRouter(_piToken, _basicConfig) {
    TROLLER = _compConfig.troller;
    UNDERLYING = IERC20(VBep20Interface(_basicConfig.staking).underlying());
    XVS = IERC20(_compConfig.xvs);
  }

  /*** THE PROXIED METHOD EXECUTORS FOR VOTING ***/

  function _claimRewards(ReserveStatus) internal override {
    // #1. Claim XVS
    address[] memory holders = new address[](1);
    holders[0] = address(piToken);
    address[] memory tokens = new address[](1);
    tokens[0] = staking;

    uint256 xvsBefore = XVS.balanceOf(address(piToken));
    piToken.callExternal(
      TROLLER,
      VenusComptrollerInterface.claimVenus.selector,
      abi.encode(holders, tokens, false, true),
      0
    );
    uint256 xvsEarned = XVS.balanceOf(address(piToken)).sub(xvsBefore);
    if (xvsEarned > 0) {
      _distributeReward(XVS, xvsEarned);
    }

    emit ClaimRewards(msg.sender, xvsEarned);
  }

  /*** OWNER METHODS ***/

  function initRouter() external onlyOwner {
    address[] memory tokens = new address[](1);
    tokens[0] = staking;
    bytes memory result =
      piToken.callExternal(TROLLER, VenusComptrollerInterface.enterMarkets.selector, abi.encode(tokens), 0);
    uint256[] memory err = abi.decode(result, (uint256[]));
    require(err[0] == NO_ERROR_CODE, "V_ERROR");
    _callStaking(IERC20.approve.selector, abi.encode(staking, uint256(-1)));
  }

  function stake(uint256 _amount) external onlyOwner {
    _stake(_amount);
  }

  function redeem(uint256 _amount) external onlyOwner {
    _redeem(_amount);
  }

  /*** POKE HOOKS ***/

  function _beforePoke(bool _willClaimReward) internal override {
    super._beforePoke(_willClaimReward);
    require(VBep20Interface(staking).accrueInterest() == NO_ERROR_CODE, "V_ERROR");

    uint256 last = lastStakedAmount;
    if (last > 0) {
      uint256 current = _getUnderlyingStaked();
      if (current > last) {
        uint256 diff = current - last;
        // ignore the dust
        if (diff > 100) {
          _distributePerformanceFee({ _underlying: XVS, _totalReward: diff });
        }
      }
    }
  }

  function _afterPoke(ReserveStatus reserveStatus, bool _rewardClaimDone) internal override {
    super._afterPoke(reserveStatus, _rewardClaimDone);
    if (_rewardClaimDone) {
      lastStakedAmount = _getUnderlyingStaked();
    }
  }

  function _rebalancePoke(ReserveStatus reserveStatus, uint256 diff) internal override {
    if (reserveStatus == ReserveStatus.SHORTAGE) {
      _redeem(diff);
    } else if (reserveStatus == ReserveStatus.EXCESS) {
      _stake(diff);
    }
  }

  /*** VIEWERS ***/

  /**
   * @notice Get the amount of vToken will be minted in exchange of the given underlying tokens
   * @param _tokenAmount The input amount of underlying tokens
   * @return The corresponding amount of vTokens tokens
   */
  function getVTokenForToken(uint256 _tokenAmount) external view returns (uint256) {
    // token / exchangeRate
    return _tokenAmount.mul(1e18) / VBep20Interface(staking).exchangeRateStored();
  }

  /**
   * @notice Get the amount of underlying tokens will released in exchange of the given vTokens
   * @param _vTokenAmount The input amount of vTokens tokens
   * @return The corresponding amount of underlying tokens
   */
  function getTokenForVToken(uint256 _vTokenAmount) public view returns (uint256) {
    // vToken * exchangeRate
    return _vTokenAmount.mul(VBep20Interface(staking).exchangeRateStored()) / 1e18;
  }

  /*** INTERNALS ***/

  function _getUnderlyingStaked() internal view override returns (uint256) {
    if (staking == address(0)) {
      return 0;
    }

    uint256 vTokenAtPiToken = IERC20(staking).balanceOf(address(piToken));
    if (vTokenAtPiToken == 0) {
      return 0;
    }

    return getTokenForVToken(vTokenAtPiToken);
  }

  function _getUnderlyingReserve() internal view override returns (uint256) {
    return IERC20(UNDERLYING).balanceOf(address(piToken));
  }

  function _stake(uint256 _amount) internal {
    require(_amount > 0, "CANT_STAKE_0");

    piToken.approveUnderlying(staking, _amount);

    _callCompStaking(VBep20Interface.mint.selector, abi.encode(_amount));

    emit Stake(msg.sender, _amount);
  }

  function _redeem(uint256 _amount) internal {
    require(_amount > 0, "CANT_REDEEM_0");

    _callCompStaking(VBep20Interface.redeemUnderlying.selector, abi.encode(_amount));

    emit Redeem(msg.sender, _amount);
  }

  function _callCompStaking(bytes4 _sig, bytes memory _data) internal {
    bytes memory result = _callStaking(_sig, _data);
    uint256 err = abi.decode(result, (uint256));
    require(err == NO_ERROR_CODE, "V_ERROR");
  }
}
