// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../MockCvp.sol";

contract MockVoting {
    struct Receipt {
        bool hasVoted;
        bool support;
        uint96 votes;
    }

    struct Proposal {
        uint id;
        mapping (address => Receipt) receipts;
    }

    mapping (uint => Proposal) public proposals;
    MockCvp public token;

    constructor(MockCvp _token) public {
        token = _token;
    }

    function castVote(uint proposalId, bool support) public {
        Receipt storage receipt = proposals[proposalId].receipts[msg.sender];
        require(!receipt.hasVoted, "Already voted");
        receipt.votes = token.getPriorVotes(msg.sender);
        receipt.support = support;
        receipt.hasVoted = true;
    }

    function getReceipt(uint proposalId, address voter) public view returns (Receipt memory) {
        return proposals[proposalId].receipts[voter];
    }
}
