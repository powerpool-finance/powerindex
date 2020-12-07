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

- `PowerIndexPool` - [0x26607aC599266b21d13c7aCF7942c7701a8b699c](https://etherscan.io/address/0x26607aC599266b21d13c7aCF7942c7701a8b699c). PowerIndex is a smart pool based on Balancer AMM with upgraded functionality. It contains 8 Defi governance tokens, enables voting with underlying tokens, and dynamically changes token weights if decided. The community of CVP token holders entirely governs PowerrIndex;
- `PoolRestrictions` - [0x3885c4e1107b445dd370D09008D90b5153132FFF](https://etherscan.io/address/0x3885c4e1107b445dd370D09008D90b5153132FFF). The contract sets optional restrictions on pool capitalization, method calls in other contracts, etc;
- `VestedLPMining`(Proxy - [0xf09232320ebeac33fae61b24bb8d7ca192e58507](https://etherscan.io/address/0xf09232320ebeac33fae61b24bb8d7ca192e58507#code), Implementation - [0x5ccbf7b7a89ec43bd83f4b70871d02f700df3335](https://etherscan.io/address/0x5ccbf7b7a89ec43bd83f4b70871d02f700df3335)) is a reward contract developed to allow liquidity providers to vote and claim LP rewards. Liquidity providers (Power Index, Uniswap, Balancer) can deposit pool tokens and receive a reward in CVP and as well as voting rights, based on stake of these tokens. The accrued CVP tokens have a specified vesting period;
- `Reservoir` - [0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E](https://etherscan.io/address/0x8EbC56A13Ae7e3cE27B960b16AA57efed3F4e79E). Contract allocating CVP tokens to `LP Mining` contract;
- `Erc20PiptSwap` - [0xa600524F0c73647476D269AAAebe4F9b86eA3D7d](https://etherscan.io/address/0xa600524F0c73647476D269AAAebe4F9b86eA3D7d). The contract for supplying liquidity to the Power Index. ETH or ERC20 tokens(USDC, DAI, DPI, wBTC etc.) sent to the contract are automatically converted into index tokens (AAVE, YFI, SNX, CVP, COMP, wNXM, MKR, UNI) via Uniswap and put into the pool.

### Deprecated

- `LP Mining` - [0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC](https://etherscan.io/address/0xC0B5c7f2F5b5c6CDcc75AeBB73Ac8B5d87C68DcC). The old liquidity mining contract;
- `VestedLPMining`(Implementation - [0xaCD09e94a4FC629f9D4C09a3e5577F053fc583Ac](https://etherscan.io/address/0xaCD09e94a4FC629f9D4C09a3e5577F053fc583Ac)). The old `VestedLPMining` implementation;
- `EthPiptSwap` - [0x0228e1074bd0d089719e69f7c3bf0a97b6ab0c05](https://etherscan.io/address/0x0228e1074bd0d089719e69f7c3bf0a97b6ab0c05). The old version;
- `EthPiptSwap` - [0x91AA1D4294FD16629Fe64C570574A550827b832f](https://etherscan.io/address/0x91AA1D4294FD16629Fe64C570574A550827b832f). The old version;
- `Erc20PiptSwap` - [0x57a47A8D522c32e8d4515F8936Ee9d1A699284d1](https://etherscan.io/address/0x57a47A8D522c32e8d4515F8936Ee9d1A699284d1). The old version;
- `Erc20PiptSwap` - [0xe65040F61701940B62e18DA7A53126A58525588B](https://etherscan.io/address/0xe65040F61701940B62e18DA7A53126A58525588B). The old version;
- `PowerIndexPool` - [0xb2B9335791346E94245DCd316A9C9ED486E6dD7f](https://etherscan.io/address/0xb2B9335791346E94245DCd316A9C9ED486E6dD7f). The baby version;
- `PoolRestrictions` - [0x698967cA2fB85A6D9a7D2BeD4D2F6D32Bbc5fCdc](https://etherscan.io/address/0x698967cA2fB85A6D9a7D2BeD4D2F6D32Bbc5fCdc). The old version.
