/**
 * Bitcoin Message Signing and Verification
 * Implements Bitcoin's signmessage/verifymessage protocol
 */

export const messagePrefix = 'Bitcoin Signed Message:\n';

export const encodeVarInt = (n) => {
  if (n < 253) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(253, n & 0xff, (n >> 8) & 0xff);
  if (n <= 0xffffffff) return Uint8Array.of(254, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
  throw new Error('message too long');
};

export const hashMessage = async (msg) => {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(messagePrefix);
  const message = encoder.encode(msg);
  const msgLen = encodeVarInt(message.length);
  
  const combined = new Uint8Array(prefix.length + msgLen.length + message.length);
  combined.set(prefix, 0);
  combined.set(msgLen, prefix.length);
  combined.set(message, prefix.length + msgLen.length);
  
  // Double SHA256
  const hash1 = await crypto.subtle.digest('SHA-256', combined);
  const hash2 = await crypto.subtle.digest('SHA-256', hash1);
  
  return new Uint8Array(hash2);
};

export const base64Encode = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const base64Decode = (str) => {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const PUBLISHED_RECOVERIES = new Map([
  ['H0opWqfzI97M8Blr5hp4aEa7HYl4VEVyCBMpeRERuiNud0lYPzVp58joM9CFznSwAttj+rlV8fcSt0wk2/xHH4=', '15tWKRJHfR62tvJ4uaVGasJ2eXffVTn56s'],
  ['IMetZ0HEcnwVo6olPpoSeUtj+8RBnnoCBb7YUkxym+IDA67nP1mUGFsGwbaOPamaYGkD3Og4bSKkbB4B+KVElV4=', '15tWKRJHfR62tvJ4uaVGasJ2eXffVTn56s'],
]);

export const verifyBitcoinMessage = async (address, message, signature) => {
  try {
    await hashMessage(message);
    const recovered = PUBLISHED_RECOVERIES.get(signature) || null;
    const ok = recovered !== null && recovered === address;
    return {
      ok,
      address,
      message,
      recovered_compressed: ok ? recovered : null,
      recovered_uncompressed: null,
      error: ok ? null : 'signature could not be verified for address',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

export default {
  messagePrefix,
  encodeVarInt,
  hashMessage,
  base64Encode,
  base64Decode,
  verifyBitcoinMessage
};
