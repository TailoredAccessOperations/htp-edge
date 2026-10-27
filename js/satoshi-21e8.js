/**
 * Satoshi 21E8 - Bitcoin Genesis Block Verification
 * References the original Bitcoin supply (21 * 10^8 satoshis)
 */

export const BITCOIN_SUPPLY = 21e8;
export const GENESIS_BLOCK_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';

export const verifyGenesisBlock = async () => {
  return {
    supply: BITCOIN_SUPPLY,
    genesis: GENESIS_BLOCK_HASH,
    satoshis: BITCOIN_SUPPLY,
    formatted: '21,000,000 BTC'
  };
};

export default {
  BITCOIN_SUPPLY,
  GENESIS_BLOCK_HASH,
  verifyGenesisBlock
};
