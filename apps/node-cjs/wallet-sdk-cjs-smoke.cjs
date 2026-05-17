try {
  const m = require('@sodax/wallet-sdk-react');
  console.log('wallet-sdk-react keys count:', Object.keys(m).length);
  console.log('useXAccount:', typeof m.useXAccount);
  console.log('getXChainType:', typeof m.getXChainType);
  console.log('SodaxWalletProvider:', typeof m.SodaxWalletProvider);
} catch (e) {
  console.error('CJS require failed:', e.message);
  process.exit(1);
}
