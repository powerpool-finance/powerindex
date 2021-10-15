// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

interface VenusComptrollerInterface {
  function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory);

  function exitMarket(address cToken) external returns (uint256);

  function claimVenus(
    address[] memory holders,
    address[] memory cTokens,
    bool borrowers,
    bool suppliers
  ) external;

  function markets(address cToken)
    external
    view
    returns (
      bool,
      uint256,
      bool
    );

  function compSpeeds(address cToken) external view returns (uint256);
}
