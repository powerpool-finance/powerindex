// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "../../interfaces/IVault.sol";
import "./PoolManagement.sol";
import "./SinglePoolManagement.sol";

abstract contract YearnFeeRefund is SinglePoolManagement {
  using SafeMath for uint256;
  using EnumerableSet for EnumerableSet.AddressSet;

  event RefundFees(address indexed vaultToken, address from, uint256 crvAmount);

  struct FeeToRefund {
    address vaultToken;
    address crvToken;
    uint256 crvAmount;
  }

  // vaultToken => fees
  mapping(address => uint256) public fees;
  // vaultTokens (append-only)
  EnumerableSet.AddressSet private feePoolTokens;

  function _accountFee(address _vaultToken, uint256 _crvAmount) internal returns (bool) {
    fees[_vaultToken] = fees[_vaultToken].add(_crvAmount);
    return feePoolTokens.add(_vaultToken);
  }

  function getFeesToRefund() external view returns (FeeToRefund[] memory) {
    uint256 len = feePoolTokens.length();

    FeeToRefund[] memory feesToRefund = new FeeToRefund[](len);

    for (uint256 i = 0; i < len; i++) {
      address vaultToken = feePoolTokens.at(i);
      address crvToken = IVault(vaultToken).token();
      uint256 crvAmount = fees[vaultToken];

      feesToRefund[i] = FeeToRefund(vaultToken, crvToken, crvAmount);
    }

    return feesToRefund;
  }

  function refundFees(
    address _refundFrom,
    address[] calldata _vaultTokens,
    uint256[] calldata _crvAmounts
  ) external {
    uint256 len = _vaultTokens.length;

    for (uint256 i = 0; i < len; i++) {
      address vaultToken = _vaultTokens[i];
      require(feePoolTokens.contains(vaultToken), "INVALID_VAULT_TOKEN");

      address crvToken = IVault(vaultToken).token();
      uint256 pendingCrvAmount = fees[vaultToken];

      IERC20(crvToken).transferFrom(_refundFrom, address(this), pendingCrvAmount);
      IERC20(crvToken).approve(vaultToken, pendingCrvAmount);
      IVault(vaultToken).deposit(pendingCrvAmount);
      uint256 vaultBalance = IERC20(vaultToken).balanceOf(address(this));
      IERC20(vaultToken).transfer(pool, vaultBalance);
      BPoolInterface(pool).gulp(vaultToken);
    }
  }
}
