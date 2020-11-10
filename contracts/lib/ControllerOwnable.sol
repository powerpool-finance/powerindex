// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an controller) that can be granted exclusive access to
 * specific functions.
 *
 * By default, the controller account will be the one that deploys the contract. This
 * can later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
contract ControllerOwnable {
    address private _controller;

    event SetController(address indexed previousController, address indexed newController);

    /**
     * @dev Initializes the contract setting the deployer as the initial controller.
     */
    constructor () internal {
        _controller = msg.sender;
        emit SetController(address(0), _controller);
    }

    /**
     * @dev Returns the address of the current controller.
     */
    function getController() public view returns (address) {
        return _controller;
    }

    /**
     * @dev Throws if called by any account other than the controller.
     */
    modifier onlyController() {
        require(_controller == msg.sender, "NOT_CONTROLLER");
        _;
    }

    /**
     * @dev Give the controller permissions to a new account (`newController`).
     * Can only be called by the current controller.
     */
    function setController(address newController) public virtual onlyController {
        require(newController != address(0), "ControllerOwnable: new controller is the zero address");
        emit SetController(_controller, newController);
        _controller = newController;
    }
}
