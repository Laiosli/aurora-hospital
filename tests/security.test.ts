import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  totp,
  verifyTotp,
  validCPF,
  validCNS,
} from "../server/security";
test("Senhas usam salt e rejeitam segredo incorreto", () => {
  const a = hashPassword("uma senha longa de teste"),
    b = hashPassword("uma senha longa de teste");
  assert.notEqual(a, b);
  assert(verifyPassword("uma senha longa de teste", a));
  assert(!verifyPassword("incorreta", a));
  assert(!verifyPassword("x", "hash inválido"));
});
test("TOTP confere vetor RFC 6238 de 6 dígitos e rejeita código inválido", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totp(secret, 1), "287082");
  assert.notEqual(verifyTotp(secret, totp(secret)), null);
  assert.equal(verifyTotp(secret, "abc"), null);
});
test("CPF/CNS: dígitos verificadores, repetidos e campos inválidos", () => {
  assert(validCPF("52998224725"));
  assert(!validCPF("52998224724"));
  assert(!validCPF("11111111111"));
  assert(!validCNS("111111111111111"));
  assert(!validCNS("123"));
});
