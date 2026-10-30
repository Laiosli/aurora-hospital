# Aurora Hospital — plano anterior à implementação

> Documento de planejamento original preservado. A implementação posterior da recepção está detalhada em `06-recepcao-agendas-leitos.md`; o status atual está em `PROGRESSO.md`.

## Premissas e limite desta entrega
Instituição fictícia, duas unidades de demonstração, pt-BR, UTC no banco e fuso por unidade. Etapa 1 é uma fundação executável: autenticação, autorização por ação/unidade, sessões, cadastros, configuração e auditoria. Não é prontuário certificado nem sistema autorizado para operação assistencial. Serviços clínicos ficam pendentes; nenhuma tela simula gravações. Dados reais não são permitidos nesta versão.

## Mapa e matriz de requisitos
| Ordem / módulo | Submenus previstos | Etapa | Entrega 1 / rastreabilidade |
|---|---|---|---|
|1 Gerenciamento|Painel gerencial; Indicadores assistenciais e operacionais; Unidades e setores; Leitos; Usuários e permissões; Configurações; Auditoria; Integrações; Monitoramento operacional|1, 2, 6|Painel derivado do banco, unidades/setores, usuários/perfis, serviços e auditoria; `/api/overview`, `/api/units`, `/api/sectors`, `/api/users`, `/api/settings`, `/api/audit`|
|2 Recepção/Pacientes|Cadastro de pacientes; Agendamentos; Recepção e check-in; Filas; Atendimentos; Internações e movimentações; Autorizações; Documentos|1–2|Cadastro separado do atendimento, provisórios, homônimos, CPF/CNS opcionais; `/api/patients` e `/:id`|
|3 Apoio|Laboratório; Diagnóstico por imagem; Solicitações e resultados; Transporte interno; Higienização; Nutrição; Serviço social; Manutenção e engenharia clínica|3, 6|Contrato conceitual, sem conector ativo|
|4 Faturamento|Contas por atendimento; Produção SUS; Convênios; Particular; Contratos e tabelas; Guias e autorizações; Lotes; Glosas e recursos; Conciliação|5|Modelo previsto; nenhuma exportação oficial|
|5 Administrativo|Contas a pagar; Contas a receber; Caixa e bancos; Fluxo de caixa; Centros de custo; Contratos; Fornecedores; Pessoas e escalas; Patrimônio; Documentos administrativos|5|Modelo previsto; sem folha/fiscal|
|6 Clínicos|Prontuário; Triagem e classificação; Consulta; Evoluções; Prescrição; Enfermagem; Administração de medicamentos; Solicitação de exames; Procedimentos; Internação; Cirurgia; Alta|3–4|Não implementado; nenhum acesso clínico concedido à TI|
|7 Suprimentos/Estoque|Produtos e materiais; Medicamentos; Almoxarifados e farmácias; Requisições; Compras; Recebimento; Movimentações; Dispensação e devolução; Inventário; Lotes e validade; Relatórios|4|Modelo previsto, sem movimentações simuladas|

## Arquitetura e decisões
React/TypeScript → API NestJS v1 (prefixo `/api`) → repositório SQL parametrizado → PostgreSQL. Monólito com módulos de autenticação, estrutura, pacientes e governança. Migrações SQL versionadas; transação agrupa gravação, idempotência e auditoria. UUIDs, FKs, checks e índices únicos reforçam regras no banco. Atualização de paciente usa versão otimista. Valores futuros serão `numeric(18,2)` ou centavos inteiros, nunca float.

No ambiente local sem Docker, PGlite executa PostgreSQL embarcado no backend com persistência em disco. Não é localStorage. É recurso demonstrativo de instância única; testes nele não comprovam concorrência ou operação do PostgreSQL em rede. PostgreSQL via `pg` é o destino de homologação. Mesmo SQL versionado nos dois adaptadores. Não há fila ou cache nesta etapa, pois não há processamento assíncrono de negócio.

Sessão opaca em cookie HttpOnly/SameSite Strict; apenas hash do token no banco. Senhas com scrypt N=32768/r=8/p=1 e salt aleatório. TOTP exigido para administrador técnico; outros perfis ainda requerem política institucional de MFA. Prazo absoluto de sessão: 30 minutos. Revogação e papel consultados a cada requisição. Escritas exigem origem permitida e cabeçalho anti-CSRF, com cookies restritos. Sem recuperação pública de senha nesta etapa. Não há upload/exportação clínica.

Auditoria tem hash encadeado e trigger que impede UPDATE/DELETE. Isso protege contra usuários de aplicação, não contra proprietário/superusuário do banco. Encaminhamento WORM, âncora externa e segregação de credenciais são pendentes de implantação. Leituras de pacientes são auditadas sem conteúdo clínico. A API retorna erros com correlação, sem stack trace ou SQL.

## Perfis e ações iniciais
| Perfil | Visualizar | Criar/alterar | Gestão de acesso | Dados clínicos |
|---|---|---|---|---|
|Administração técnica|estrutura, usuários, configuração, auditoria técnica|estrutura, usuários, serviços|criar, trocar perfil, desativar, revogar sessões|não|
|Gestão hospitalar|estrutura, indicadores cadastrais|—|não|não|
|Recepção|pacientes da unidade, estrutura|pacientes da unidade|não|não|
|Médico / Enfermagem|cadastro de pacientes da unidade, estrutura|— nesta etapa|não|pendente de vínculo assistencial na etapa 3|
|Farmácia / Laboratório / Imagem / Faturamento / Financeiro / Compras / Almoxarifado / Serviço social|estrutura|— nesta etapa|não|não|
|Auditoria|estrutura e eventos técnicos|—|não|não|

Permissões são códigos de ação, persistidos por perfil. Vínculos limitam unidades; setor ativo é contexto de navegação, ainda não fronteira de autorização clínica. Perfis iniciais são atribuíveis pela UI, composição customizada de permissões exige migração revisada nesta etapa. Acesso emergencial, vínculo assistencial e segregação financeira serão introduzidos antes dos respectivos fluxos; não há bypass emergencial genérico.

## Fluxos desta etapa
Login + TOTP quando exigido → escolha de unidade/setor → início por perfil → cadastro de paciente → busca/paginação → edição com versão → auditoria. Repetir POST com a mesma chave e mesmo corpo devolve o mesmo resultado; chave reutilizada com outro corpo é rejeitada. CPF/CNS duplicado na unidade é rejeitado; homônimos geram aviso. Identificação provisória não exige documento. Sem mesclagem automática.

## Dependências e validações
PostgreSQL, proxy TLS, domínio/origem, cofre de segredos, identidade/MFA, armazenamento privado e monitoramento devem ser definidos pela TI. Direção assistencial valida identificadores, risco, formulários, prescrições, alergias, dupla checagem e protocolos. Financeiro valida contratos/tabelas; jurídico/encarregado valida finalidades, bases legais e retenção. LIS/PACS/operadoras/SUS precisam contratos, credenciais, especificações vigentes e homologação. Nenhuma tabela TISS/TUSS/AIH/APAC/BPA ou decisão clínica foi inventada.

## Etapas executáveis
1. Entrega atual: fundação acima, UI, migração, dados fictícios, testes e instruções.
2. Agenda, conflito de sala/profissional, episódios e máquina de estados; leitos com exclusão concorrente; mesclagem revisada.
3. Documentos versionados, vínculo assistencial, auditoria de leitura, solicitações/resultados/retificações; validação clínica.
4. Produtos/lotes, FEFO, reserva/dispensação transacional, validação farmacêutica, administração e devolução separadas.
5. Contas com tabela congelada, recebimento parcial, estorno e segregação financeira.
6. Serviços de apoio, relatórios, outbox/inbox idempotente, retry limitado, fila de falhas e conectores homologados.
7. Testes multiprocesso PostgreSQL, segurança independente, carga declarada, restauração, acessibilidade e homologação institucional.

Referências técnicas consultadas: https://docs.nestjs.com/v11/security/authorization e https://www.postgresql.org/docs/current/sql-set-transaction.html. Requisitos regulatórios não foram implementados nem declarados conformes.
