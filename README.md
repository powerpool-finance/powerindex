# PowerIndex
This repository contains PowerIndex smart contracs. PowerIndex is an ecosystem product of PowerPool. The main feature of PowerIndex is a possibility to create special pools, not available in Balancer with unique governance and pool design.

Based on Uniswap, Balancer, and Sushiswap code.

🚨 Security review status: **partially audited**

## Contracts on Ethereum Main Network
* `LP Mining` - [0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC](https://etherscan.io/address/0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC). It is a reward contract developed to allow liquidity providers to vote and claim LP rewards. Liquidity providers (Uniswap, Balancer, etc.) can deposit pool tokens and receive a reward in CVP and as well as voting rights, based on stake of these tokens;
* `Reservoir` - [0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E](https://etherscan.io/address/0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E). Contract allocating CVP tokens to `LP Mining` contract.
* `EthPiptSwap` - [0x333EfDc7465f516744186A007378fc005cb0b456](https://etherscan.io/address/0x333EfDc7465f516744186A007378fc005cb0b456). The contract for supplying liquidity to the Power Index. ETH sent to the contract is automatically converted into index tokens (LEND, YFI, SNX, CVP, COMP, wNXM, MKR, UNI) via Uniswap and put into the pool.
