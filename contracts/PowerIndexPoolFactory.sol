// SPDX-License-Identifier: GPL-3.0
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is disstributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity 0.6.12;

// Builds new Power Index Pools, logging their addresses and providing `isPowerIndexPool(address) -> (bool)`

import "./PowerIndexPool.sol";
import "./interfaces/PowerIndexPoolFactoryInterface.sol";

contract PowerIndexPoolFactory is PowerIndexPoolFactoryInterface {
  event LOG_NEW_POOL(address indexed caller, address indexed pool);

  mapping(address => bool) public isPowerIndexPool;

  constructor() public {}

  function newPool(
    string calldata name,
    string calldata symbol,
    uint256 minWeightPerSecond,
    uint256 maxWeightPerSecond
  ) external override returns (PowerIndexPoolInterface) {
    PowerIndexPool pool = new PowerIndexPool(name, symbol, minWeightPerSecond, maxWeightPerSecond);
    isPowerIndexPool[address(pool)] = true;
    emit LOG_NEW_POOL(msg.sender, address(pool));
    pool.setController(msg.sender);
    return PowerIndexPoolInterface(address(pool));
  }
}
