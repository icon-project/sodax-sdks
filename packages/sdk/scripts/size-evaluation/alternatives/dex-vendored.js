// Representative vendored replacement for the PancakeSwap surface DEX uses: CL tick/sqrt-price math,
// liquidity-for-amounts, position amounts, price helpers, pool id/key codec and calldata encoders over viem.
import { encodeAbiParameters, keccak256, decodeAbiParameters, encodeFunctionData } from 'viem';
import CLPositionManagerAbi from './abi/CLPositionManagerAbi.json' with { type: 'json' };
import CLPoolManagerAbi from './abi/CLPoolManagerAbi.json' with { type: 'json' };
const Q96 = 1n << 96n,
  Q192 = Q96 * Q96,
  MAX_U256 = (1n << 256n) - 1n;
const MIN_TICK = -887272,
  MAX_TICK = 887272;
const MAGIC = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];
export function getSqrtRatioAtTick(tick) {
  if (tick < MIN_TICK || tick > MAX_TICK) throw new Error('TICK');
  const abs = BigInt(tick < 0 ? -tick : tick);
  let ratio = abs & 1n ? MAGIC[0] : 1n << 128n;
  for (let i = 1; i < 20; i++) if (abs & (1n << BigInt(i))) ratio = (ratio * MAGIC[i]) >> 128n;
  if (tick > 0) ratio = MAX_U256 / ratio;
  return ratio % (1n << 32n) > 0n ? (ratio >> 32n) + 1n : ratio >> 32n;
}
export function getTickAtSqrtRatio(sqrt) {
  let lo = MIN_TICK,
    hi = MAX_TICK;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (getSqrtRatioAtTick(mid) <= sqrt) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
const mulDiv = (a, b, d) => (a * b) / d;
const mulDivUp = (a, b, d) => {
  const p = a * b;
  return p % d ? p / d + 1n : p / d;
};
export function maxLiquidityForAmount0(a, b, amount0) {
  if (a > b) [a, b] = [b, a];
  return mulDiv(mulDiv(a, b, Q96), amount0, b - a);
}
export function maxLiquidityForAmount1(a, b, amount1) {
  if (a > b) [a, b] = [b, a];
  return mulDiv(amount1, Q96, b - a);
}
export function maxLiquidityForAmounts(cur, a, b, amount0, amount1) {
  if (a > b) [a, b] = [b, a];
  if (cur <= a) return maxLiquidityForAmount0(a, b, amount0);
  if (cur < b) {
    const l0 = maxLiquidityForAmount0(cur, b, amount0),
      l1 = maxLiquidityForAmount1(a, cur, amount1);
    return l0 < l1 ? l0 : l1;
  }
  return maxLiquidityForAmount1(a, b, amount1);
}
const amount0Delta = (a, b, l, up) => {
  if (a > b) [a, b] = [b, a];
  const n1 = l << 96n,
    n2 = b - a;
  return up ? mulDivUp(mulDivUp(n1, n2, b), 1n, a) : mulDiv(n1, n2, b) / a;
};
const amount1Delta = (a, b, l, up) => {
  if (a > b) [a, b] = [b, a];
  return up ? mulDivUp(l, b - a, Q96) : mulDiv(l, b - a, Q96);
};
export const PositionMath = {
  getToken0Amount(tick, lower, upper, sqrt, l) {
    if (tick < lower) return amount0Delta(getSqrtRatioAtTick(lower), getSqrtRatioAtTick(upper), l, false);
    if (tick < upper) return amount0Delta(sqrt, getSqrtRatioAtTick(upper), l, false);
    return 0n;
  },
  getToken1Amount(tick, lower, upper, sqrt, l) {
    if (tick < lower) return 0n;
    if (tick < upper) return amount1Delta(getSqrtRatioAtTick(lower), sqrt, l, false);
    return amount1Delta(getSqrtRatioAtTick(lower), getSqrtRatioAtTick(upper), l, false);
  },
};
export class Price {
  constructor(base, quote, denominator, numerator) {
    Object.assign(this, { base, quote, denominator: BigInt(denominator), numerator: BigInt(numerator) });
  }
  invert() {
    return new Price(this.quote, this.base, this.numerator, this.denominator);
  }
  toSignificant(d = 6) {
    const s = 10n ** BigInt(this.base.decimals),
      q = 10n ** BigInt(this.quote.decimals);
    return Number((this.numerator * s * 10n ** 18n) / (this.denominator * q)) / 1e18 === 0
      ? '0'
      : (Number((this.numerator * s * 10n ** 18n) / (this.denominator * q)) / 1e18).toPrecision(d);
  }
}
export const sqrtRatioX96ToPrice = (sqrt, t0, t1) => new Price(t0, t1, Q192, sqrt * sqrt);
export const tickToPrice = (t0, t1, tick) => sqrtRatioX96ToPrice(getSqrtRatioAtTick(tick), t0, t1);
const POOL_KEY = [
  { type: 'address', name: 'currency0' },
  { type: 'address', name: 'currency1' },
  { type: 'address', name: 'hooks' },
  { type: 'address', name: 'poolManager' },
  { type: 'uint24', name: 'fee' },
  { type: 'bytes32', name: 'parameters' },
];
export const getPoolId = k =>
  keccak256(encodeAbiParameters(POOL_KEY, [k.currency0, k.currency1, k.hooks, k.poolManager, k.fee, k.parameters]));
export const decodePoolKey = data => decodeAbiParameters(POOL_KEY, data);
const modifyLiquidities = (actions, params, deadline) =>
  encodeFunctionData({
    abi: CLPositionManagerAbi,
    functionName: 'modifyLiquidities',
    args: [encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, params]), deadline],
  });
export const encodeCLPositionManagerMintCalldata = (p, d) =>
  modifyLiquidities(
    '0x0211',
    [
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'int24' }, { type: 'int24' }, { type: 'uint256' }],
        [getPoolId(p.poolKey), p.tickLower, p.tickUpper, p.liquidity],
      ),
    ],
    d,
  );
export const encodeCLPositionManagerIncreaseLiquidityCalldata = (p, d) =>
  modifyLiquidities(
    '0x0011',
    [encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [p.tokenId, p.liquidity])],
    d,
  );
export const encodeCLPositionManagerDecreaseLiquidityCalldata = (p, d) =>
  modifyLiquidities(
    '0x0111',
    [encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [p.tokenId, p.liquidity])],
    d,
  );
export { CLPositionManagerAbi, CLPoolManagerAbi, getTickAtSqrtRatio as TickMathGetTickAtSqrtRatio };
