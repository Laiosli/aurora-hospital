# Aurora Hospital — recepção, registro clínico e continuidade (0.4)

Sistema original de gestão hospitalar em pt-BR. React + TypeScript, NestJS, SQL PostgreSQL, demonstração local persistida via PGlite. **Não está pronto para operação hospitalar real.** A fundação da etapa 1 foi preservada e o núcleo operacional da etapa 2 foi acrescentado. O escopo restante continua registrado, sem simulação de recursos inexistentes. Veja `docs/06-recepcao-agendas-leitos.md` e `docs/PROGRESSO.md` para o estado atual.

## Abrir a instalação já preparada neste computador
Execute `INICIAR.ps1` na pasta do projeto se o servidor estiver parado. Abra http://127.0.0.1:3000 e consulte `ACESSO-LOCAL.md` para as credenciais geradas desta instalação. A sessão dura 30 minutos. O administrador técnico exige TOTP. O arquivo de acesso não integra o pacote ZIP.

## Instalação nova
Requer Node.js 22+ e npm 10+. Em um terminal na pasta do projeto:

```powershell
npm ci
node scripts/setup-demo.cjs
npm run seed
npm run seed:operations
npm run build
npm start
```

O setup gera `.env` e `ACESSO-LOCAL.md` com segredos aleatórios locais. Não sobrescreve configuração existente. O seed cria instituição fictícia, duas unidades, setores, 14 perfis e contas, dois homônimos e paciente provisório. Recusa banco já inicializado. **Nunca copie o seed para produção**. `data/demo/` armazena os dados no servidor. Uma instância apenas pode abrir esse diretório.

Em instalação existente, **não execute o seed básico novamente**. Pare o servidor, preserve backup, execute `npm run migrate`, `npm run build` e `npm start`. O bootstrap também verifica migrações antes de aceitar requisições. O seed operacional é opcional e adiciona recursos fictícios sem recriar pessoas/contas; veja seu efeito sobre os serviços demonstrativos no manual 06.

Frontend e API são servidos juntos pela porta 3000. O sistema não envia informações para serviços externos. Não depende de fontes ou CDNs. `localStorage` não é utilizado.

## Desenvolvimento
Em dois terminais: `npm run dev` e `npm run dev:web`. Ajuste `APP_ORIGIN=http://127.0.0.1:5173` no `.env` e acesse exatamente essa origem. Vite encaminha `/api` para o backend; cookies ficam na origem da página. Retorne a origem para a porta 3000 ao usar o build.

## PostgreSQL em Docker — fornecido, não executado neste computador
Configure `POSTGRES_PASSWORD` (URL-safe), `DEMO_PASSWORD` (14+ caracteres) e `ADMIN_TOTP_SECRET` (Base32 aleatória 32+ caracteres), por ambiente ou `.env`. Docker Compose monta a mesma aplicação com banco em volume separado:

```powershell
docker compose up --build -d
docker compose exec app node dist/server/seed.js
```

A aplicação aplica a migração na inicialização. Espere o banco saudável antes do seed. A porta publicada fica restrita ao localhost. Docker é para reprodução de desenvolvimento; a conta proprietária usada no exemplo deve ser separada da conta de runtime antes da homologação. O segredo da conta técnica única é provisionado no ambiente; novas contas técnicas estão bloqueadas até implementar MFA individual completo.

## Verificações
```powershell
npm run build
npm test
```
Resultados e limites estão em `docs/04-verificacao.md`. Não trate o resultado no PostgreSQL embarcado como comprovação de concorrência multiprocesso em servidor PostgreSQL.

## Organização e entregáveis
- `web/`: sete módulos, navegação, formulários, tabelas, contexto e ajuda.
- `server/`: autenticação, autorização, cadastros, estrutura, auditoria e adaptadores de banco.
- `migrations/`: fundação 001 e recepção 002, com checksums e aplicação incremental.
- `tests/`: testes unitários e integração HTTP/banco.
- `docs/01-planejamento.md`: premissas, matriz de módulos, permissões, etapas e dependências.
- `docs/02-modelo-dados.md`: modelo físico e modelo lógico futuro, integridade e retenção.
- `docs/03-operacao.md`: instalação por ambiente, manual por perfil, backup, contingência e homologação.
- `docs/04-verificacao.md`: cobertura, resultados e limitações.
- `docs/05-api.md`: contratos, erros e exemplos. OpenAPI em `/api/openapi.json`.
- `docs/06-recepcao-agendas-leitos.md`: novos fluxos, entidades, permissões, API e testes.
- `docs/PROGRESSO.md`: ponto de retomada e pendências do escopo completo.

## O que esta entrega faz
Login, TOTP técnico, sessão revogável, restrição por unidade/ação, cadastro/consulta/edição de pacientes, provisórios, validação de CPF/CNS, aviso de homônimos, paginação/ordenação no servidor, idempotência, versão otimista, unidades/setores, usuários/perfis, configuração de serviços, indicadores cadastrais reais, preferências e auditoria encadeada.

Agora também: salas e agendas, bloqueios e conflitos, confirmação/reagendamento/cancelamento/falta, check-in transacional, episódios e filas, transições autorizadas, reserva/ocupação/transferência de leitos, alta operacional, confirmação de higienização, histórico e indicadores operacionais persistidos.

## O que não faz
Prontuário clínico completo, classificação de risco, prescrição, exames, estoque, administração de medicamentos, faturamento, financeiro e conectores são etapas futuras. Calendários completos, espera/encaixes, mesclagem e autorizações ainda estão pendentes na etapa 2. Não há assinatura digital, recuperação pública de senha, MFA universal, armazenamento de anexos, exportações sensíveis, offline, monitoramento automático de backups, integração simulada ou promessa de conformidade. O processo bloqueia `APP_ENV=producao` nesta versão.

## Registro clínico disponível na versão 0.3
Prontuário/Evoluções por atendimento com vínculo assistencial, documentos versionados, finalização sem assinatura digital, retificação/cancelamento, avaliações de alergias e sinais vitais. Consulte docs/07-registro-clinico.md para permissões, limites, API, testes e roteiro de demonstração. A etapa clínica completa permanece em desenvolvimento.

## Continuidade e backups — versão 0.4
Bloqueio de instância, backup lógico criptografado, restauração isolada verificável, restauração para diretório novo e submenu Gerenciamento > Gestão de backups. Leia docs/08-continuidade-e-backups.md antes de ativar a atualização: as instâncias antigas ainda precisam ser encerradas normalmente e a base canônica deve ser definida. A falha do banco original não foi recuperada por esta entrega.
