// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.7.0;

/**
 * @title Interface of the AdminUpgradeabilityProxy contract from the @openzeppelin/upgrades package
 */
interface IAdminUpgradeabilityProxy {
  /**
   * @dev Emitted when the implementation is upgraded.
   * @param implementation Address of the new implementation.
   */
  event Upgraded(address indexed implementation);

  /**
   * @dev Emitted when the administration has been transferred.
   * @param previousAdmin Address of the previous admin.
   * @param newAdmin Address of the new admin.
   */
  event AdminChanged(address previousAdmin, address newAdmin);

  /**
   * @return The address of the proxy admin.
   * Only the admin can call this function.
   */
  function admin() external returns (address);

  /**
   * @return The address of the implementation.
   * Only the admin can call this function.
   */
  function implementation() external returns (address);

  /**
   * @dev Changes the admin of the proxy.
   * Only the admin can call this function.
   * @param newAdmin Address to transfer proxy administration to.
   */
  function changeAdmin(address newAdmin) external;

  /**
   * @dev Upgrade the backing implementation of the proxy.
   * Only the admin can call this function.
   * @param newImplementation Address of the new implementation.
   */
  function upgradeTo(address newImplementation) external;

  /**
   * @dev Upgrade the backing implementation of the proxy and call a function
   * on the new implementation.
   * This is useful to initialize the proxied contract.
   * Only the admin can call this function.
   * @param newImplementation Address of the new implementation.
   * @param data Data to send as msg.data in the low level call.
   * It should include the signature and the parameters of the function to be called, as described in
   * https://solidity.readthedocs.io/en/v0.4.24/abi-spec.html#function-selector-and-argument-encoding.
   */
  function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;

  /**
   * @dev The following slots hold the admin and the logic contracts addresses (see the EIP-1967):
   * ADMIN_SLOT: 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103
   * IMPLEMENTATION_SLOT: 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
   */
}
