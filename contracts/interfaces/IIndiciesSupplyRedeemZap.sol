// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IIndiciesSupplyRedeemZap {
  function poolSwapContract(address) external view returns (address);

  function depositErc20(
    address _pool,
    address _inputToken,
    uint256 _amount
  ) external;

  function depositPoolToken(
    address _pool,
    address _outputToken,
    uint256 _poolAmount
  ) external;
}
