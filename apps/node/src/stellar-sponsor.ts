// Use a throwaway STELLAR_ACTIVATE_SEED and never commit credentials.

import 'dotenv/config';
import { DEFAULT_SPONSORING_API_ENDPOINT, Sodax, type HttpUrl } from '@sodax/sdk';
import { StellarWalletProvider } from '@sodax/wallet-sdk-core';

function isHttpUrl(value: string): value is HttpUrl {
  return value.startsWith('http://') || value.startsWith('https://');
}

const ACTIVATE_SEED = process.env.STELLAR_ACTIVATE_SEED;
const SPONSORING_API_KEY = process.env.SPONSORING_API_KEY;
const SPONSORING_API_URL_OVERRIDE = process.env.SPONSORING_API_URL;

if (!ACTIVATE_SEED) throw new Error('STELLAR_ACTIVATE_SEED missing in .env (Stellar secret seed, starts with S)');
if (!ACTIVATE_SEED.startsWith('S')) throw new Error('STELLAR_ACTIVATE_SEED must be a Stellar secret seed (S…)');
if (!SPONSORING_API_KEY) throw new Error('SPONSORING_API_KEY missing in .env');
if (SPONSORING_API_URL_OVERRIDE !== undefined && !isHttpUrl(SPONSORING_API_URL_OVERRIDE))
  throw new Error('SPONSORING_API_URL must be an http(s) base URL, e.g. http://localhost:3011');

const SPONSORING_API_URL: HttpUrl = SPONSORING_API_URL_OVERRIDE ?? DEFAULT_SPONSORING_API_ENDPOINT;

const sodax = new Sodax({
  api: {
    sponsoringApiConfig: {
      baseURL: SPONSORING_API_URL,
      apiKey: SPONSORING_API_KEY,
      timeout: 120_000,
      headers: {},
    },
  },
});

// The provider strips this type-level `0x` prefix before parsing the Stellar seed.
const walletProvider = new StellarWalletProvider({
  type: 'PRIVATE_KEY',
  privateKey: `0x${ACTIVATE_SEED}`,
  network: 'PUBLIC',
});

async function main(): Promise<void> {
  const address = await walletProvider.getWalletAddress();
  console.log(`sponsoring API : ${SPONSORING_API_URL}`);
  console.log(`activating     : ${address}\n`);

  const config = await sodax.sponsoring.getStellarSponsorConfig();
  if (!config.ok) {
    console.error('getStellarSponsorConfig failed:', config.error.message, config.error.context);
    process.exitCode = 1;
    return;
  }
  console.log('sponsor config :', {
    sponsorAccount: config.value.sponsorAccount,
    totalFeeBandStroops: [config.value.minTotalFeeStroops, config.value.maxTotalFeeStroops],
    recommendedPerOperationFeeStroops: config.value.recommendedPerOperationFeeStroops,
    maxTimeboundSeconds: config.value.maxTimeboundSeconds,
    requiredStartingBalance: config.value.requiredStartingBalance,
  });

  const active = await sodax.sponsoring.isStellarAccountActive({ address });
  if (!active.ok) {
    console.error('\nisStellarAccountActive failed:', active.error.message);
    process.exitCode = 1;
    return;
  }
  console.log(`\nalready active : ${active.value}`);

  const result = await sodax.sponsoring.activateStellarAccount({
    address,
    walletProvider,
    // Surface sequence conflicts because there is no user to re-prompt.
    allowSequenceRetry: false,
    onSignatureRequired: ({ attempt, reason }) => console.log(`  signing (attempt ${attempt}, ${reason})`),
  });

  if (!result.ok) {
    const { error } = result;
    console.error('\nactivateStellarAccount failed');
    console.error(`  code       : ${error.code}`);
    console.error(`  message    : ${error.message}`);
    console.error(`  nextAction : ${String(error.context?.nextAction)}`);
    console.error(`  httpStatus : ${String(error.context?.status)}`);
    console.error(`  wireCode   : ${String(error.context?.code)}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nactivated:', result.value);
}

void main();
