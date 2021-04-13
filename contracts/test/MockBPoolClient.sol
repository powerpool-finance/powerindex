// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../EthPiptSwap.sol";

contract MockBPoolClient {
  receive() external payable {}

  function callBPoolTwice(EthPiptSwap piptSwap) external payable {
    piptSwap.swapEthToPipt{ value: msg.value / 2 }(0.1 ether, 0, 0.1 ether);
    piptSwap.swapEthToPipt{ value: msg.value / 2 }(0.1 ether, 0, 0.1 ether);
  }
}
