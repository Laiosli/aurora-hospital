const fs = require("node:fs");
const crypto = require("node:crypto");
if (fs.existsSync(".env")) {
  console.error(".env já existe; configuração preservada.");
  process.exit(1);
}
const password = crypto.randomBytes(18).toString("base64url");
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const secret = Array.from(crypto.randomBytes(32), (n) => alphabet[n % 32]).join(
  "",
);
fs.writeFileSync(
  ".env",
  `APP_ENV=demonstracao\nDB_MODE=pglite\nPGLITE_PATH=./data/demo\nPORT=3000\nAPP_ORIGIN=http://127.0.0.1:3000\nDEMO_PASSWORD=${password}\nADMIN_TOTP_SECRET=${secret}\n`,
  { mode: 0o600 },
);
fs.writeFileSync(
  "ACESSO-LOCAL.md",
  `# Acesso à demonstração local\n\nEndereço: http://127.0.0.1:3000\n\n- Recepção: recepcao@demo.local\n- Gestão: gestao@demo.local\n- Auditoria: auditoria@demo.local\n- Senha gerada exclusivamente para esta instalação: \`${password}\`\n\nAs demais contas fictícias usam a mesma senha apenas no seed de demonstração.\n\nAdministração técnica: ti@demo.local, com a senha acima e TOTP obrigatório. Configure seu autenticador com o segredo ADMIN_TOTP_SECRET do arquivo .env (SHA-1, seis dígitos, 30 segundos). Não compartilhe o segredo.\n\nNão use credenciais ou dados reais. Este arquivo e .env são locais e não devem entrar em repositórios ou no pacote de distribuição.\n`,
  { mode: 0o600 },
);
console.log(
  "Configuração local gerada. Leia ACESSO-LOCAL.md. Execute npm run seed antes de iniciar.",
);
