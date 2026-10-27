import { bootBtcVerification } from "/dist/js/btc-verify.min.js";
import { bootSatoshi21e8, startMoneyConfetti } from "/dist/js/satoshi-21e8.min.js";
import { startE8Panel } from "/js/money-e8.mjs";
import { bootPgpVerification } from "/js/money-pgp.mjs";
import { bootSpendControl } from "/js/money-spend.mjs";

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

Promise.allSettled([
  bootBtcVerification("#btc-verify-root"),
  bootSatoshi21e8("#satoshi-21e8-root"),
  bootPgpVerification("#pgp-verify-root"),
  bootSpendControl("#spend-api-root"),
  startE8Panel(),
]).then(() => {
  if (!reduced) startMoneyConfetti();
});