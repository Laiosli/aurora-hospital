// Offline maintenance only. Never open a database used by a legacy server.
require('dotenv').config({ quiet: true });
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  if (process.env.APP_ENV !== 'demonstracao') throw new Error('Somente demonstração.');
  const password = process.env.TI_NEW_PASSWORD;
  if (!password || password.length < 6 || password.length > 128) throw new Error('Defina TI_NEW_PASSWORD (6 a 128 caracteres).');
  const target = process.env.PGLITE_PATH;
  if (!target || !fs.existsSync(path.join(target, 'PG_VERSION'))) throw new Error('Informe PGLITE_PATH de uma base existente.');
  for (const pid of [2296, 28168]) {
    try { process.kill(pid, 0); throw new Error(`Instância antiga ${pid} ainda ativa. Encerre normalmente antes da manutenção.`); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  for (const port of new Set([3000, 3001, Number(process.env.PORT) || 3000])) {
    const listening = await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve(false) : reject(error));
      socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Não foi possível verificar a porta.')); });
    });
    if (listening) throw new Error(`Porta ${port} ativa. Encerre o servidor normalmente antes da manutenção.`);
  }
  process.env.DB_MODE = 'pglite';
  const { Database } = require('../dist/server/db');
  const { hashPassword, verifyPassword } = require('../dist/server/security');
  const { audit } = require('../dist/server/audit');
  const db = new Database();
  try {
    await db.transaction(async q => {
      const user = (await q.query("SELECT id,role_id FROM users WHERE email=$1 AND role_id='ti' AND active=true", ['ti@demo.local'])).rows[0];
      if (!user) throw new Error('Conta T.I demonstrativa não encontrada.');
      await q.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(password), user.id]);
      await q.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      await audit(q, user, 'users.password_changed', user.id, undefined, 'Troca local solicitada pelo responsável no ambiente demonstrativo.');
      const row = (await q.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0];
      if (!verifyPassword(password, row.password_hash)) throw new Error('Verificação da senha falhou.');
    });
    console.log('Senha da conta T.I alterada e verificada. Sessões anteriores revogadas.');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
