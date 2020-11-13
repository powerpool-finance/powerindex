// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.7.0;

/**
 * @title Interface for the ProxyAdmin contract from the @openzeppelin/upgrades package
 */
interface IProxyAdmin {
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

  /**
   * @dev Returns the current implementation of a proxy.
   * This is needed because only the proxy admin can query it.
   * @return The address of the current implementation of the proxy.
   */
  function getProxyImplementation(address proxy) external view returns (address);

  /**
   * @dev Returns the admin of a proxy. Only the admin can query it.
   * @return The address of the current admin of the proxy.
   */
  function getProxyAdmin(address proxy) external view returns (address);

  /**
   * @dev Changes the admin of a proxy.
   * @param proxy Proxy to change admin.
   * @param newAdmin Address to transfer proxy administration to.
   */
  function changeProxyAdmin(address proxy, address newAdmin) external;

  /**
   * @dev Upgrades a proxy to the newest implementation of a contract.
   * @param proxy Proxy to be upgraded.
   * @param implementation the address of the Implementation.
   */
  function upgrade(address proxy, address implementation) external;

  /**
   * @dev Upgrades a proxy to the newest implementation of a contract and forwards a function call to it.
   * This is useful to initialize the proxied contract.
   * @param proxy Proxy to be upgraded.
   * @param implementation Address of the Implementation.
   * @param data Data to send as msg.data in the low level call.
   * It should include the signature and the parameters of the function to be called, as described in
   * https://solidity.readthedocs.io/en/v0.4.24/abi-spec.html#function-selector-and-argument-encoding.
   */
  function upgradeAndCall(
    address proxy,
    address implementation,
    bytes memory data
  ) external payable;

  /**
   * @return the address of the owner.
   */
  function owner() external view returns (address);

  /**
   * @return true if `msg.sender` is the owner of the contract.
   */
  function isOwner() external view returns (bool);

  /**
   * @dev Allows the current owner to relinquish control of the contract.
   * @notice Renouncing to ownership will leave the contract without an owner.
   * It will not be possible to call the functions with the `onlyOwner`
   * modifier anymore.
   */
  function renounceOwnership() external;

  /**
   * @dev Allows the current owner to transfer control of the contract to a newOwner.
   * @param newOwner The address to transfer ownership to.
   */
  function transferOwnership(address newOwner) external;
}
