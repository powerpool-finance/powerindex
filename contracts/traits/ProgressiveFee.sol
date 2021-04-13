// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract ProgressiveFee is OwnableUpgradeSafe {
  using SafeMath for uint256;

  uint256[] public feeLevels;
  uint256[] public feeAmounts;
  address public feePayout;
  address public feeManager;

  event SetFees(
    address indexed sender,
    uint256[] newFeeLevels,
    uint256[] newFeeAmounts,
    address indexed feePayout,
    address indexed feeManager
  );

  modifier onlyFeeManagerOrOwner() {
    require(msg.sender == feeManager || msg.sender == owner(), "NOT_FEE_MANAGER");
    _;
  }

  function setFees(
    uint256[] calldata _feeLevels,
    uint256[] calldata _feeAmounts,
    address _feePayout,
    address _feeManager
  ) external onlyFeeManagerOrOwner {
    feeLevels = _feeLevels;
    feeAmounts = _feeAmounts;
    feePayout = _feePayout;
    feeManager = _feeManager;

    emit SetFees(msg.sender, _feeLevels, _feeAmounts, _feePayout, _feeManager);
  }

  function calcFee(uint256 amount, uint256 wrapperFee) public view returns (uint256 feeAmount, uint256 amountAfterFee) {
    uint256 len = feeLevels.length;
    for (uint256 i = 0; i < len; i++) {
      if (amount >= feeLevels[i]) {
        feeAmount = amount.mul(feeAmounts[i]).div(1 ether);
        break;
      }
    }
    feeAmount = feeAmount.add(wrapperFee);
    amountAfterFee = amount.sub(feeAmount);
  }

  function getFeeLevels() external view returns (uint256[] memory) {
    return feeLevels;
  }

  function getFeeAmounts() external view returns (uint256[] memory) {
    return feeAmounts;
  }
}
