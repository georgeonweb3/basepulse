# BasePulseReceipts

On-chain receipt registry + daily check-in log used by the BasePulse app.
No tokens, no fees, no owner or admin functions, holds no funds.

- `mintReceipt(bytes32 txHash, string label)` – anchor a tx hash (label ≤ 64 bytes, no duplicates per wallet)
- `checkIn()` – once per UTC day; streak resets after a missed day
- Views: `getReceipts(user, offset, limit)` (newest first), `receiptCount`, `checkIns`, `currentStreak`, `canCheckIn`, `totalReceipts`, `totalCheckIns`

## Test
    forge install foundry-rs/forge-std --no-git
    forge test

## Deploy to Base mainnet (needs a little ETH on Base for gas)
    forge script script/Deploy.s.sol --rpc-url https://mainnet.base.org --broadcast --interactive 1
    # optional: add --verify --etherscan-api-key <BASESCAN_KEY>

Or paste `src/BasePulseReceipts.sol` into Remix (compiler 0.8.28, EVM cancun),
connect your wallet on Base and deploy.

Then set `NEXT_PUBLIC_RECEIPT_CONTRACT=<deployed address>` in Vercel and redeploy.
