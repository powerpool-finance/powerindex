// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.7.0;

/**
 * @title Interface for `Ownable` (and `OwnableUpgradeSafe`) from the "@openzeppelin" package(s)
 */
interface IOwnable {
  /**
   * @dev Emitted when the ownership is transferred from the `previousOwner` to the `newOwner`.
   */
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

  /**
   * @dev Returns the address of the current owner.
   */
  function owner() external view returns (address);

  /**
   * @dev Transfers ownership of the contract to a new account (`newOwner`).
   * Can only be called by the owner.
   */
  function transferOwnership(address newOwner) external;

  /**
   * @dev Leaves the contract without owner.
   * Can only be called by the owner.
   * It will not be possible to call `onlyOwner` functions anymore.
   */
  function renounceOwnership() external;
}
