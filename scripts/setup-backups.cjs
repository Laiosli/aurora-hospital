const fs=require('node:fs');const crypto=require('node:crypto');
const file='.env';const env=fs.readFileSync(file,'utf8');
if(!/^APP_ENV=demonstracao\r?$/m.test(env))throw new Error('Configuração automática limitada à demonstração.');
if(/^BACKUP_ENCRYPTION_KEY=.+$/m.test(env)){console.log('Chave existente preservada.');process.exit(0)}
const result=env.replace(/^BACKUP_ENCRYPTION_KEY=.*\r?\n?/gm,'').trimEnd()+'\nBACKUP_ENCRYPTION_KEY='+crypto.randomBytes(32).toString('base64')+'\n';
fs.writeFileSync(file,result,{mode:0o600});console.log('Chave local de backup configurada. Guarde uma cópia protegida separada do servidor.');
