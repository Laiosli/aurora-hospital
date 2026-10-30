# Continuidade e backups — versão 0.4.0

## Diagnóstico que motivou esta entrega
Comparação completa: `../analise-erp/DIAGNOSTICO-COMPARATIVO.md`, a partir da raiz do projeto. A referência ERP foi analisada apenas estaticamente: 17 formulários próprios, 274 componentes e 47 executáveis conhecidos encontrados; sem execução, credenciais ou acesso a seus destinos. A arquitetura React/NestJS/PostgreSQL foi mantida e as sete abas foram preservadas. “Gestão de backups” é submenu de Gerenciamento.

O problema concreto prioritário era continuidade: a base `data/demo` apresentou falha de checkpoint, e havia risco de abrir o mesmo diretório PGlite em dois processos. As cópias `demo-recuperacao-20261030` e `demo-ti-facilitado` derivam de um backup anterior e não são bases sincronizadas. **Esta entrega não recuperou o banco original nem mesclou essas bases.**

## O que foi implementado
- Bloqueio exclusivo por diretório canônico, adquirido antes de abrir PGlite. Uma segunda instância da versão atual é recusada. O lock só é removido depois do fechamento do banco. Fechamento repetido é idempotente.
- Encerramento gracioso por Ctrl+C/SIGTERM e, quando iniciado por um processo pai com IPC, mensagem local `shutdown`. O pai recebe `stopped` após fechamento. Nenhuma rota pública de encerramento ou interface de depuração foi criada.
- Backup lógico manual com a ferramenta oficial `@electric-sql/pglite-tools@0.2.21`, compatível com o motor existente `@electric-sql/pglite@0.3.16`. A versão do motor foi fixada, sem migração de tecnologia.
- Cópia integral criptografada com AES-256-GCM; chave Base64 de 32 bytes fora do código. Metadados incluem hash SHA-256 do arquivo, tamanho, horário, responsável, unidade de solicitação e impressões digitais de todas as tabelas públicas.
- Repetir a criação com mesma chave e mesmo corpo retorna o mesmo registro; outro corpo com a chave antiga é rejeitado. Só uma rotina por processo é executada de cada vez. Falha não é apresentada como sucesso.
- Verificação restaura a cópia em um PGlite isolado e compara quantidade e conteúdo de todas as tabelas. Registra sucesso/falha e auditoria. Não substitui o banco em uso.
- Utilitário de restauração definitiva para **diretório novo**, sem alterar configuração da aplicação nem sobrescrever destino existente.
- Tela Gerenciamento → Gestão de backups com estado vazio, carregamento, erro, criação, verificação e data de evidência. Arquivos não são publicados por URL e a API não devolve o SQL.

O dump altera a transação/contexto SQL da conexão. O adaptador encerra a transação de leitura e restaura `search_path` antes de devolver a conexão às operações normais. Esse problema foi encontrado e corrigido pelos testes; a origem continua recebendo auditoria após o backup.

## Permissões e ambiente
Migração aditiva `005_backup_permissions.sql`: acrescenta `backups.manage` ao T.I. Somente esse perfil, com a permissão, em demonstração PGlite pode executar esta rotina. O dump inclui todas as unidades do banco; não é exportação de uma unidade ou relatório de pacientes. A unidade no registro limita a listagem e identifica o contexto da solicitação.

O modo facilitado do T.I e seu MFA desativado permanecem como pedido, apenas sob as flags demonstrativas. Homologação/produção não recebem essa exceção. Para PostgreSQL em servidor, backups exigem `pg_dump` e política própria de operação; esta rotina retorna restrição em vez de simular uma cópia.

## Ativar com segurança
As instâncias antigas das portas 3000 e 3001 continuavam ativas na verificação desta execução. Não foram encerradas à força nem seus bancos foram abertos diretamente. O código 0.4.0 foi compilado e validado em isolamento; a base dessas instâncias ainda não recebeu a migração 005. A tela vista no teste de interface usou uma aplicação temporária em memória, não a base em uso.

1. Definir a base canônica com o responsável. Se a opção for a demonstração atual, o launcher `INICIAR-TI-DEMO.ps1` aponta a `data/demo-ti-facilitado`. Não trocar esse caminho silenciosamente nem reaplicar o seed.
2. Encerrar a instância antiga normalmente e confirmar o fim do processo. Instâncias antigas não implementam o lock cooperativo novo; não abrir seu diretório enquanto estiverem ativas. Este trabalho não usou inspector nem `Stop-Process`.
3. Com o banco parado, preservar uma cópia offline integral separada. Manter também os diretórios originais com falha para recuperação especializada; não usar reset de WAL como rotina.
4. Configurar a chave e iniciar a versão atual com a mesma base selecionada. O bootstrap aplica a migração 005, verificando checksums das anteriores. A operação atual continua bloqueada se a base original com falha for selecionada.

Na pasta do projeto:

```powershell
npm run backup:setup
npm run build
.\INICIAR-TI-DEMO.ps1
```

`backup:setup` acrescenta uma chave aleatória à configuração de demonstração, preservando a existente. **Guardar uma cópia protegida da chave fora da máquina é responsabilidade da operação.** Sem ela, os arquivos criptografados não podem ser restaurados. Não imprimir a chave nem incluí-la em repositório ou suporte. O diretório padrão `private-backups` é excluído do Git e do contexto Docker. Os arquivos usam modo restrito quando suportado pelo sistema; ACLs Windows, cópia externa e política de retenção continuam a cargo da infraestrutura.

## Manual de uso
1. Entrar como T.I, selecionar unidade e abrir **Gerenciamento → Gestão de backups**.
2. Informar justificativa e clicar **Criar cópia protegida**. Aguardar a confirmação.
3. Clicar **Verificar restauração isolada**. Apenas a evidência “Verificada em…” confirma que o conteúdo foi restaurado e comparado.
4. Guardar cópia externa protegida dos arquivos `.enc` e manifestos `.json`, junto da política de custódia separada da chave. Não existe upload externo automático nesta entrega.

Restauração em novo diretório absoluto, a partir de uma cópia produzida por esta rotina:

```powershell
npm run backup:restore -- --id IDENTIFICADOR_COMPLETO --target 'C:\Caminho\Novo\BancoRestaurado'
```

Alternativa usando build: `node dist/server/restore-backup.js --id IDENTIFICADOR --target DIRETORIO_ABSOLUTO_NOVO`.

O destino não pode existir. A chave e `BACKUP_DIRECTORY` devem apontar ao conjunto correto. O utilitário valida autenticidade/integridade, restaura esquema/dados e compara tabelas; salva recibo `AURORA-RESTORE.json` no destino. Não aponta a aplicação automaticamente a esse diretório. Se ocorrer falha, preservar o destino incompleto para diagnóstico; não iniciá-lo como banco validado. Dumps incluem dados sensíveis e históricos; o arquivo SQL não é devolvido ao navegador.

## Contratos de API
Sessão, origem e proteção CSRF seguem os contratos anteriores.

| Rota | Conteúdo e comportamento |
|---|---|
|GET `/api/backups`|Até 50 registros recentes do contexto, configuração e rotina em andamento; sem SQL/chave|
|POST `/api/backups`|`{reason}` e `Idempotency-Key`; criação protegida e auditada|
|POST `/api/backups/:id/verify`|`{reason}`; restauração isolada, comparação e evidência auditada|

Nenhuma dessas rotas restaura sobre o banco ativo. Criação/execução ficam disponíveis apenas ao T.I demonstrativo. 403: perfil/ambiente; 409: conflito/integridade; 503: chave ausente ou criação falhou. Metadados “preparing” deixados por encerramento abrupto não constituem cópia válida e precisam de revisão; não há retomada automática de tarefa interrompida.

## Testes executados
`npm run build`: TypeScript de servidor/interface e Vite aprovados (`build-continuidade.txt`). `npm test`: **70 testes aprovados, zero falhas** (`testes-continuidade.txt`).

Os oito testes novos cobrem: exclusão de diretório/alias; duas instâncias e persistência após fechar; permissão/chave ausente; idempotência e arquivo criptografado; restauração isolada e origem preservada; restauração em novo diretório e recusa de sobrescrita; adulteração detectada; dois processos reais com recusa do segundo e fechamento do primeiro por IPC, seguido de reabertura do registro persistido.

A interface foi exercitada com T.I sem MFA: lista vazia → criação com justificativa → cópia criada → restauração isolada verificada. Evidência visual: `../aurora-backup-verificado.png`, relativa à raiz do projeto. A aplicação temporária foi encerrada normalmente após o teste. Nenhum dado do ERP ou de produção foi usado.

## Medições reproduzíveis
Executar `npm run benchmark:local`. O script força PGlite em memória e dados sintéticos; não usa bases existentes. Resultado: `medicoes-continuidade.json`.

- 1.006 pacientes no banco de teste, mesma base antes/depois da rotina.
- 80 requisições HTTP medidas no total: 20 sequenciais e 20 em lotes de cinco antes da rotina; a mesma carga depois. Zero falhas.
- p95 sequencial: 15,09 ms antes e 18,26 ms depois. Não foi demonstrada melhoria; são duas amostras locais antes/depois da execução do backup, não comparação entre versões.
- Dump e criptografia: aproximadamente 441 ms. Restauração isolada e comparação: aproximadamente 981 ms.
- O JSON contém quantidade/duração acumulada de consultas SQL, CPU do processo e memória antes/depois. Duração acumulada de consultas inclui espera; não é tempo exclusivo de CPU do banco.

Não foram medidos tempo visual de telas, produção, PostgreSQL em rede, picos contínuos de memória ou capacidade sustentada. Não há gargalo de performance comprovado ou comparação com o ERP. A serialização do dump bloqueia outras operações no adaptador durante a cópia; agendamento e processamento por job para bases grandes permanecem pendentes. Não foram introduzidos índices ou cache sem evidência.

## Pendências e próximos passos
Recuperação especializada da base original; definição/ativação da base canônica sem perda; backups automáticos, cópia externa, retenção/alertas e RPO/RTO institucionais. Locks são cooperativos entre versões atuais e falham fechados após crash; não são garantia contra programa antigo ou acesso direto ao diretório. A liberação de lock abandonado exige comprovar que não há processo usando a base, preservar cópia e seguir revisão operacional; não há remoção automática insegura.

Depois dessa base operacional, continuar solicitações/amostras/resultados entre Clínicos e Apoio; em seguida farmácia/estoque e contas, mantendo estados distintos e validação institucional. SAE/SND, regras clínicas, faturamento e contabilidade ainda não podem ser deduzidos dos rótulos da referência. Os demais requisitos do prompt original permanecem pendentes conforme o diagnóstico; esta entrega não declara cobertura completa do ERP ou liberação para produção.
