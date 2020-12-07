# PowerIndex

![CI](https://github.com/powerpool-finance/powerindex/workflows/CI/badge.svg)
[![codecov](https://codecov.io/gh/powerpool-finance/powerindex/branch/master/graph/badge.svg)](https://codecov.io/gh/powerpool-finance/powerindex)

This repository contains PowerIndex smart contracs. PowerIndex is the main product of PowerPool. The main feature of PowerIndex is a possibility to create special pools with unique governance and pool design.

✅🚨 Security review status: **partially audited**

More details in 👉:
- [`PowerIndexPool.sol` and `PoolRestrictions.sol` Security Audit by MixBytes](https://github.com/powerpool-finance/powerpool-docs/blob/master/audits/PowerIndexPoolSecurityAuditScope1.pdf)
- [`VestedLPMining.sol` and `PowerIndexPoolController.sol` Security Audit by Pessimistic](https://github.com/powerpool-finance/powerpool-docs/blob/master/audits/PowerIndexPool_SecurityAudit_Scope1_Pessimistic.pdf)


## Contracts on Ethereum Main Network

### Active

- `PowerIndexPool` - [0x26607aC599266b21d13c7aCF7942c7701a8b699c](https://etherscan.io/address/0x26607aC599266b21d13c7aCF7942c7701a8b699c). PowerIndex is a smart pool based on Balancer AMM with upgraded functionality. It contains 8 Defi governance tokens, enables voting with underlying tokens, and dynamically changes token weights if decided. The community of CVP token holders entirely governs PowerrIndex.
- `VestedLPMining`(Proxy - [0xf09232320ebeac33fae61b24bb8d7ca192e58507](https://etherscan.io/address/0xf09232320ebeac33fae61b24bb8d7ca192e58507#code), Implementation - [0x5ccbf7b7a89ec43bd83f4b70871d02f700df3335](https://etherscan.io/address/0x5ccbf7b7a89ec43bd83f4b70871d02f700df3335)) is a reward contract developed to allow liquidity providers to vote and claim LP rewards. Liquidity providers (Power Index, Uniswap, Balancer) can deposit pool tokens and receive a reward in CVP and as well as voting rights, based on stake of these tokens. The accrued CVP tokens have a specified vesting period;
- `Reservoir` - [0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E](https://etherscan.io/address/0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E). Contract allocating CVP tokens to `LP Mining` contract.
- `EthPiptSwap` - [0x0228e1074bd0d089719e69f7c3bf0a97b6ab0c05](https://etherscan.io/address/0x0228e1074bd0d089719e69f7c3bf0a97b6ab0c05). The contract for supplying liquidity to the Power Index. ETH sent to the contract is automatically converted into index tokens (LEND, YFI, SNX, CVP, COMP, wNXM, MKR, UNI) via Uniswap and put into the pool.

### Deprecated

- `LP Mining` - [0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC](https://etherscan.io/address/0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC). The old liquidity mining contract;
- `VestedLPMining`(Implementation - [0xaCD09e94a4FC629f9D4C09a3e5577F053fc583Ac](https://etherscan.io/address/0xaCD09e94a4FC629f9D4C09a3e5577F053fc583Ac)). The old `VestedLPMining` implementation;
