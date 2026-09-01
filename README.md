# ShieldNet

On-chain smart contract audit bounty board for BOT Chain. A decentralized bug bounty platform where project owners post bounties on smart contracts, security auditors submit findings with severity levels, and approved findings earn rewards.

## Setup

```bash
npm install
cp .env.example .env
# Add your private key to .env
```

## Compile

```bash
npx hardhat compile
```

## Test

```bash
npx hardhat test
```

## Deploy

```bash
# Testnet
npx hardhat run scripts/deploy.js --network botchain_testnet

# Mainnet
npx hardhat run scripts/deploy.js --network botchain_mainnet
```

After deployment, update `CONTRACT_ADDRESS` in `frontend/index.html` with the deployed address.

## Frontend

Open `frontend/index.html` in a browser or deploy via Vercel. Requires MetaMask with BOT Chain Testnet configured.
