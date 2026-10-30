import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  try {
    const [salt, hash] = stored.split(":");
    return timingSafeEqual(
      Buffer.from(hash, "hex"),
      scryptSync(password, salt, 64, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      }),
    );
  } catch {
    return false;
  }
}
function decode32(s: string) {
  let bits = "";
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const i = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c);
    if (i < 0) throw new Error("Base32 inválida");
    bits += i.toString(2).padStart(5, "0");
  }
  return Buffer.from(bits.match(/.{8}/g)!.map((v) => parseInt(v, 2)));
}
export function totp(secret: string, step = Math.floor(Date.now() / 30000)) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", decode32(secret)).update(b).digest();
  const o = h[19] & 15;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
export function verifyTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(Date.now() / 30000);
  for (const step of [current - 1, current, current + 1])
    if (timingSafeEqual(Buffer.from(code), Buffer.from(totp(secret, step))))
      return step;
  return null;
}
export function validCPF(value: string) {
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  for (let n = 9; n <= 10; n++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(value[i]) * (n + 1 - i);
    const digit = ((sum * 10) % 11) % 10;
    if (digit !== Number(value[n])) return false;
  }
  return true;
}
export function validCNS(v: string) {
  return (
    /^\d{15}$/.test(v) &&
    !/^(\d)\1+$/.test(v) &&
    v.split("").reduce((s, d, i) => s + Number(d) * (15 - i), 0) % 11 === 0
  );
}
