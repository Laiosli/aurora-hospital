# Evidências, cobertura e limites

> **Histórico da primeira entrega.** Na retomada, a suíte foi ampliada para 46 testes aprovados. A cobertura atual, seus limites e a preservação dos dados estão em `06-recepcao-agendas-leitos.md` e `testes-etapa2.txt`. A lista de pendências abaixo é o registro anterior, não o status atual de leitos/agendas.

Execução em 29/10/2026, Windows, Node.js 24.22.1, NestJS 11, React 19, TypeScript 5 e PostgreSQL embarcado PGlite. O runtime do Docker está proposto como Node.js 22. O lockfile registra versões exatas instaladas. Relatório bruto: `testes-executados.txt`.

## Resultados executados
- **Build:** compilação TypeScript backend/frontend e bundle Vite concluídos sem erros.
- **Testes:** 25 testes aprovados, zero falhas (3 unitários e 22 testes de integração HTTP/banco). O teste de falha de auditoria injeta deliberadamente um erro 500, verifica rollback e registra um evento operacional sanitizado; isso é resultado esperado.
- **Persistência:** banco em diretório temporário fechado e reaberto; seis cadastros recuperados. Não é teste de restauração de backup.
- **Navegador:** login da recepção; cadastro provisório sem documento; confirmação do servidor; busca e consulta; alteração com justificativa; persistência após recarregar; aviso de alterações não salvas; painel com contagens atualizadas; restrição visual de acesso técnico. Dados de teste marcados como fictícios permaneceram na demonstração local.
- **Visual:** revisão em viewport de computador (1440 × 1000), tablet (1024 × 768) e painel estreito do navegador. Tabelas largas usam rolagem horizontal; navegação pode ser recolhida. Foco do modal e contraste foram ajustados. Não equivale a auditoria WCAG, ensaio completo com leitor de tela ou homologação em dispositivo físico.
- **Dependências:** consulta `npm audit`, correção de avisos em `multer` e `js-yaml` via overrides compatíveis, nova consulta sem vulnerabilidades conhecidas reportadas no momento. O relatório `dependencias-audit.json` contém o resultado das dependências de execução. Isso não comprova ausência de vulnerabilidades.

O sandbox local bloqueou a primeira conexão de teste por HTTP; a suíte foi executada novamente com acesso a localhost. Nenhum resultado dessa tentativa bloqueada foi contado como aprovação. Docker não está instalado nesta máquina; não foi possível executar o compose ou validar PostgreSQL em rede.

## Requisitos → tela → endpoint → evidência
| Requisito | Tela / fluxo | Endpoint / implementação | Evidência |
|---|---|---|---|
|Autenticação e senha|Login|POST /auth/login, security.ts|Hash com salt, senha incorreta e sessão anônima|
|MFA privilegiado|Login técnico|TOTP + used_totp|Vetor RFC 6238, obrigatoriedade e replay|
|Permissão por ação|Início conforme perfil / acesso restrito|AccessGuard, roles.permissions|TI não lê pacientes; enfermagem não cria cadastro|
|Restrição de unidade|Cabeçalho e cadastros|X-Unit-Id + FK/vínculo|403 entre unidades e 404 por UUID fora do escopo|
|Paciente sem documento|Novo paciente|POST /patients|Provisório com CPF/CNS/nascimento nulos aceito|
|Duplicidade|Novo paciente / busca|Validador + UNIQUE unidade/CPF/CNS|CPF duplicado 409, inválido 400|
|Homônimos|Tabela de pacientes|GET /patients|Dois homônimos com aviso e nascimento distinto|
|Paginação / ordenação|Tabela de pacientes|GET /patients|Página 1 e 2 diferentes; sort restrito|
|Concorrência cadastral|Editar cadastro|PATCH /patients/:id + version|Versão obsoleta 409 e justificativa obrigatória|
|Repetição segura|Salvar cadastro|Idempotency-Key + transação|POSTs concorrentes retornam mesmo UUID e um evento; corpo divergente 409|
|Gravação confiável|Confirmação / erro|Transação SQL|Falha na auditoria desfaz cadastro e não retorna sucesso|
|Proteção de escrita|Todos os formulários|Origem + cabeçalho + cookie Strict|Origem externa / cabeçalho ausente 403|
|Estrutura|Unidades e setores|POST/GET units/sectors|Persistência, vínculo do autor, fuso inválido|
|Serviços configuráveis|Configurações|PATCH /settings|Persistência, controle de versão e bloqueio por perfil|
|Preferências individuais|Favoritos/recentes/colunas|GET/PATCH preferences|Isolamento entre contas|
|Gestão de acesso|Usuários e permissões|PATCH users/:id e POST revoke|Troca de perfil, revogação, expiração e logout encerram sessão|
|Abuso de login|Login|Contadores no banco|Oito falhas; nona retorna 429|
|Auditoria|Auditoria|Tabela/trigger/hash + GET audit|Encadeamento recomputado; UPDATE rejeitado; sem senha no resultado|
|Continuidade básica|Servidor de dados|Database.close / reabertura|Persistência em disco; restauração de backup pendente|
|Contrato API|Documentação|GET openapi.json|Disponível sem dados de pacientes|

## Matriz de situação funcional
| Categoria | Situação |
|---|---|
|Implementado e testado|Fundação descrita acima; autenticação/sessões, ações por perfil/unidade, cadastros, estrutura, usuários, configuração, preferências, auditoria e indicadores cadastrais|
|Demonstrativo|Instituição, duas unidades, contas individuais, pacientes fictícios; PGlite de instância única; tela de evolução das etapas|
|Integração simulada|Nenhuma. Não há conector fingindo transmitir/receber dados|
|Dependente de credenciais/infraestrutura|Identidade externa, TLS, armazenamento privado, backups externos, logs centralizados, LIS/PACS/operadoras/SUS, contabilidade e mensageria|
|Pendente de desenvolvimento|Agendas, atendimentos, leitos, prontuário, farmácia/estoque, contas/financeiro, apoio, relatórios e jobs; fases 2–7|
|Pendente de validação institucional|Protocolos clínicos, requisitos legais e privacidade, retenção, assinatura, segregação financeira, modelos, tabelas e homologação de integrações|
|Fundação a ampliar antes de homologação|Composição customizada de permissões pela UI, autorização por setor/vínculo assistencial, MFA individual completo, recuperação de senha, histórico completo de versões cadastrais, arquivamento externo de auditoria, revisão de logging/limitação de abuso, migrações incrementais com trava/checksum, expurgo de metadados|

## Critérios de aceitação do escopo completo ainda não executados
1. Ocupação simultânea de leito e movimentações de internação.
2. Duas dispensações com saldo insuficiente, lotes vencidos/bloqueados, FEFO, devoluções e estornos.
3. Documento clínico concorrente, retificação preservando original e acesso por vínculo assistencial.
4. Prescrição → validação → dispensação → administração com conferências profissionais.
5. Conta fechada preservada após alteração de tabela, recebimento parcial e segregação de funções.
6. Falha/reprocessamento de integração, outbox e aceitação externa separada de transmissão.
7. Restauração PostgreSQL com RPO/RTO medidos, backup automatizado e recuperação de versão.
8. Fluxo integrado assistencial de 16 passos, carga em volume institucional e avaliação de usabilidade clínica.

Não há números de desempenho ou cobertura percentual inventados. Testes foram feitos com base pequena (seed de seis pacientes, acrescida dos registros criados pela suíte). A implementação usa locks globais em idempotência/auditoria, cuja contenção precisa ser medida em PostgreSQL real antes de expansão.
