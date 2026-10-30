# Registro de retomada — 30/10/2026

## Estado atual
Versão 0.3.0 em desenvolvimento incremental. Etapas 1 e núcleo da etapa 2 preservados; núcleo de registro clínico acrescentado à etapa 3. As sete abas permanecem na ordem original. Não houve recriação da base nem reaplicação do seed inicial.

Última interrupção: teste de interface no formulário Registrar sinal vital. Na retomada de 30/10, o servidor não estava em execução. Build concluído e servidor reiniciado: PID 13904, porta 3000, health ok na versão 0.3.0. Estado clínico já persistido: episódio 0ca57714-0830-47ef-a1d9-44564e7c06df do paciente fictício de inicialização, vínculo do médico, evolução retificada com três versões e avaliação de alergia fictícia. O teste de sinal vital foi concluído: registro fictício 36,5 °C e retificação para 36,6 °C, original preservado. Página recarregada e ambas as medições recuperadas do backend.

## Implementado nesta continuação
- Migração aditiva 003: vínculos assistenciais, documentos clínicos e versões imutáveis, avaliações de alergias e sinais vitais.
- Prontuário/Evoluções conectados à API e ao atendimento existente.
- Vínculo assistencial com confirmação de paciente/setor e justificativa; restrição por unidade e permissões no servidor. Apenas médico/enfermagem podem aderir. Adesão autodeclarada é política demonstrativa, ainda depende de validação institucional.
- Rascunho, finalização sem assinatura digital, retificação e cancelamento com autoria, motivo, versão otimista e idempotência. Histórico preserva o original.
- Alergias: não investigadas, informação indisponível, sem alergias conhecidas, alergias registradas com substância/reação. Avaliações anteriores preservadas.
- Sinais vitais manuais com unidade fixa, horário, autoria e retificação imutável. Sem decisão clínica automatizada.
- Correção de apresentação: nascimento em formato brasileiro e estados operacionais em português.

## Evidências já concluídas
- 61 testes aprovados, zero falhas: docs/testes-clinicos.txt (46 de regressão e 15 clínicos).
- Build backend/frontend aprovado após a correção textual; docs/build-clinico.txt registra a compilação final.
- Migração real aplicada e comparada antes/depois: docs/migracao-clinica.json. Preservados integralmente 8 pacientes, 14 usuários, 1 atendimento, 1 agendamento, 3 leitos e os 63 eventos anteriores de auditoria. A contagem total inclui ambas as unidades.
- Backup offline e fonte anterior: work/retomada-clinica, relativo à pasta da conversa.
- Interface: recepção abriu episódio e fez check-in/encaminhamento; médico viu bloqueio antes do vínculo, aderiu, criou evolução, finalizou e retificou. Histórico exibiu as três versões. Alergia fictícia foi registrada e apareceu no cabeçalho.

## Ponto exato para continuar
1. Versão 0.3.0 compilada, em execução e com teste de interface concluído. Não editar migrações 001–003 já aplicadas. Manual completo desta entrega: docs/07-registro-clinico.md.
2. Entrar como medico@demo.local com senha de ACESSO-LOCAL.md, abrir Clínicos > Prontuário e o episódio do paciente Teste de inicialização · FICTÍCIO para explorar o exemplo persistido.
3. Próxima implementação: solicitações, amostras, liberação/retificação de resultados integradas a Apoio, com política de acesso específica para laboratório/imagem e testes; depois prescrição/farmácia/estoque. Preservar pendências de recepção (espera/encaixes, mesclagem, autorizações, calendários completos).
4. Complementar controles clínicos: vínculo atribuído/revogado e acesso emergencial revisado, negativos contextuais auditados independentemente da transação, histórico autorizado entre episódios, demais formulários e validação institucional. A adesão atual é autodeclarada e demonstrativa.
## Escopo ainda pendente
Prontuário completo: diagnósticos/problemas estruturados, histórico entre atendimentos com autorização específica, classificação de risco validada, solicitações/resultados, prescrição, administração, enfermagem/cirurgia completas, anexos, assinatura digital e acesso emergencial revisado. Etapas 4–7: estoque/farmácia, faturamento/financeiro, apoio/relatórios/integrações e homologação. Nenhuma integração externa foi simulada como ativa. Docker/PostgreSQL em rede, carga, acessibilidade completa e validação institucional ainda não executados. Produção continua bloqueada.

## Acesso
http://127.0.0.1:3000 no mesmo computador. Credenciais existentes em ACESSO-LOCAL.md. Se parado: executar INICIAR.ps1 na pasta outputs/hospital. Não rodar setup/seed sobre a base existente. O servidor não foi instalado como serviço do Windows.

## Incidente de reinício — 30/10/2026
O reinício solicitado encontrou PANIC de checkpoint no banco data/demo. O original não foi substituído; cópia integral adicional em work/reinicio-recuperacao/demo-antes, relativo à conversa. Não executar reset de WAL nem descartar dados sem recuperação e validação. Foi preparada base SEPARADA data/demo-recuperacao-20261030, derivada de work/retomada-clinica/demo-antes: 8 pacientes, 14 usuários, 0 documentos clínicos. Migrações até 003 aplicadas nesta cópia; código atual preservado. A demonstração foi iniciada com PGLITE_PATH apontando somente para essa cópia; .env continua apontando para o original. Os exemplos clínicos mais recentes não integram este backup. Investigar recuperação do original, exportar logicamente e implementar reinício gracioso/controle de instância antes de novos reinícios. Não usar Stop-Process para rotina de parada do banco embarcado.

## Modo facilitado do T.I — 30/10/2026
A pedido do usuário, foram adicionadas flags explícitas DEMO_TI_FULL_ACCESS e DEMO_DISABLE_TI_MFA. Só têm efeito com APP_ENV=demonstracao. Permissões efetivas de TI são a união dos perfis existentes; vínculo/autoria clínicos têm exceção auditada para exploração. Conteúdo finalizado e histórico continuam protegidos. Documentos criados pelo T.I usam categoria ti_demo (migração 004). Homologação mantém MFA e segregação. Build aprovado; 62 testes aprovados, zero falhas, incluindo a exceção demonstrativa e sua ineficácia em homologação.
A instância antiga na porta 3000 foi preservada. Nova instância facilitada em http://127.0.0.1:3001, base separada data/demo-ti-facilitado, copiada do backup offline validado em work/retomada-clinica/demo-antes. Não inclui amostras clínicas posteriores. Iniciar com INICIAR-TI-DEMO.ps1; tutorial TUTORIAL-RAPIDO.md. O .env original não foi modificado.
Uma tentativa de preparar encerramento via process._debugProcess foi rejeitada pela aprovação automática por poder expor o inspector e não ser parada graciosa. Não foi executada nem contornada; utilizou-se uma instância nova em cópia offline, preservando a anterior. Para futuros reinícios, usar Ctrl+C na execução interativa e aguardar db.close, sem Stop-Process.

## Evolução 0.4.0 — continuidade e backups — 30/10/2026
Pedido anexo f7e1bd6a lido como solicitação de evolução do projeto. Diagnóstico comparativo existente em outputs/analise-erp/DIAGNOSTICO-COMPARATIVO.md. Prioridade implementada: continuidade antes de ampliar fluxos. Preservadas as sete abas, stack e modo T.I facilitado.
Fonte e build 0.4.0 prontos: lock cooperativo antes de abrir PGlite, fechamento idempotente/gracioso e IPC privado do processo pai, backup lógico criptografado, verificação por restauração isolada e comparação integral de tabelas, utilitário de restauração em destino novo e tela Gestão de backups. Migração 005 acrescenta backups.manage ao T.I; não editadas migrações anteriores. Dependência oficial pglite-tools 0.2.21 com PGlite 0.3.16 exato. Chave não foi gerada na configuração em uso; usar backup:setup na ativação.
Validação final: 70 testes passaram, zero falhas (docs/testes-continuidade.txt); build aprovado; teste visual criou/verificou cópia em aplicação temporária isolada. Benchmark 1.006 pacientes sintéticos, 80 requisições, zero erros; p95 sequencial 15,09 ms antes / 18,26 ms depois da rotina, sem alegar ganho. Evidências em docs/medicoes-continuidade.json e outputs/aurora-backup-verificado.png. Manual completo: docs/08-continuidade-e-backups.md.
Situação real das bases: processos antigos ainda nas portas 3000 (PID 28168) e 3001 (PID 2296) quando verificados. Não foram parados à força, copiados em uso nem abertos por outro PGlite. A base original com falha não foi reparada. Não foi aplicada a migração 005 nas bases desses processos. A tela nova foi testada no QA em memória da porta 3101; esse QA é temporário e deve ser encerrado com comando stop no stdin, aguardando banco fechado.
Ponto exato de retomada: decidir/ativar base canônica seguindo manual 08 após fechamento normal das instâncias antigas, preservando cópia offline. As versões antigas não têm controle IPC nem participam do lock novo. Não usar inspector (rejeitado anteriormente), Stop-Process ou abrir o mesmo diretório para tentar fechar por fora. Se a ativação não for possível sem intervenção operacional, manter as bases intactas e avançar no próximo fluxo em banco de teste isolado.
Próxima implementação funcional: atendimento → solicitação de exames → amostra/execução → resultado/liberação → retificação, acesso específico de laboratório/imagem, idempotência e testes; depois prescrição/farmácia/estoque/faturamento. Faltam ainda calendário completo, espera/encaixes, mesclagem revisada, autorizações, demais fluxos da referência, recuperação por token e homologação. Backups automáticos/externos e gestão segura de locks abandonados também permanecem pendentes. Nenhum executável/destino/credencial do ERP foi executado/utilizado/acessado nesta evolução.

### Área de trabalho em cartões — 30/10/2026
Os sete módulos abrem um painel à direita com cartões e ícones maiores, sem subcategorias expansíveis na lateral. Entrada inicial exibe as opções do módulo; breadcrumb permite retornar ao painel. Permissões, favoritos e indicações de funcionalidades planejadas preservados. Verificação: TypeScript e build Vite. Sem alterações de banco de dados. Validação visual no navegador pendente nesta execução.

### Solicitação de senha e GitHub — pendente
Preparado scripts/change-demo-ti-password.cjs para manutenção offline demonstrativa com hash, auditoria e revogação de sessões. Sintaxe verificada. Execução recusou abrir o banco porque PID legado 2296 segue ativo; senha NÃO alterada. Não encerrar à força nem abrir a base em paralelo. GitHub conectado retornou zero repositórios acessíveis; aguardando link e acesso. Cópia de 82 arquivos preparada em outputs/hospital-github sem .env, dados, backups, dependências ou credenciais configuradas. Nenhum envio ao GitHub realizado. Correção do registro anterior: tentativa de inicialização PID 31320 falhou com EADDRINUSE; servidor respondendo em 3001 é PID 2296, versão 0.3.0.

### Publicação inicial no GitHub — 30/10/2026
Repositório privado criado: https://github.com/Laiosli/aurora-hospital. Publicação via navegador, mantendo pastas do código. .env, dados, backups e credenciais locais excluídos. A troca solicitada da senha T.I ainda NÃO foi aplicada: a instância legada mantém o banco aberto; o script offline recusou acesso concorrente. A aplicação local continua independente do repositório; publicação do código não hospeda a aplicação.

