# Entrega incremental 0.2 — recepção, agendas e leitos

## Retomada e preservação
A execução anterior foi interrompida na repetição dos testes após atualização de dependências. Na retomada, o build estava concluído, os arquivos estavam íntegros e o servidor anterior estava parado. Os 25 testes da fundação passaram novamente. Foram preservados um snapshot de código e uma cópia offline da base antes da migração.

A migração 002 foi aplicada de forma aditiva na base existente: **7 pacientes e 14 usuários mantidos**, com os 10 eventos antigos de auditoria preservados e um evento de migração acrescentado. Não houve recriação do banco ou reaplicação do seed inicial. As senhas e contas anteriores continuam válidas; sessões expiradas exigem novo login.

## Implementado nesta execução
| Requisito / tela | Persistência e regras | Permissões / API | Evidência |
|---|---|---|---|
|Agendamentos — recursos|Salas por setor/unidade; profissionais ativos vinculados; disponibilidade e duração 5–240 minutos|TI configura; perfis assistenciais/recepção consultam; `/resources`, `/rooms`, `/schedules`|Teste de vínculo e autorização|
|Agendamentos — consulta|Paciente conferido por nome, nascimento e UUID; duração calculada no backend; conflito de paciente, sala e profissional, inclusive entre agendas|Recepção grava; profissional consulta; `/appointments`|Disputa concorrente: uma criação e um 409|
|Bloqueios de agenda|Intervalo dentro da disponibilidade; impede bloqueio sobre consultas existentes; afeta sala/profissional compartilhados|TI; `/schedules/:id/blocks`|Bloqueio e conflito entre agendas verificados|
|Confirmação/reagendamento/cancelamento/falta|Versão otimista e justificativa; horário anterior mantido em evento; falta recusada antes do fim previsto; registros encerrados não são reeditados|Recepção; `PATCH /appointments/:id`|Reagendamento e cancelamento testados; falta antecipada negada (falta posterior ainda sem caso dedicado)|
|Recepção e check-in|Pessoa separada do episódio; check-in atualiza consulta e cria episódio na mesma transação; no máximo um episódio por agendamento|Recepção; `POST /encounters`|Duas chamadas com mesma chave geram um episódio|
|Filas / Atendimentos|Etapas explícitas, setor, horários e versão; servidor rejeita saltos/perfis indevidos; histórico paginado|Recepção encaminha; médico/enfermagem iniciam assistência e encerram; `/encounters/:id/transition`|Transições, autorização e histórico verificados|
|Leitos / Internações e movimentações|Cadastro, bloqueio, reserva, ocupação, transferência, cancelamento da reserva e higienização; restrições únicas de alocação ativa por leito e episódio|TI configura sem identidade do paciente; recepção movimenta; médico/enfermagem encerram e confirmam higienização nesta demonstração|Disputa pelo mesmo leito, transferência inválida/válida, reserva, alta e limpeza testadas|
|Indicadores operacionais|Episódios, fila e taxa de ocupação derivados do banco; denominador, unidade, origem e atualização explícitos|`overview.read`; `/operations/metrics`|Valores confrontados com eventos persistidos|
|Serviços ativos|Novos episódios, agendamentos e alocações exigem serviço habilitado; desligamento não impede encerramento de operações existentes|Configuração já existente; validação adicional no backend|Serviço desligado e continuidade de encerramento testados|
|Migrações|Descoberta incremental, SHA-256, transação e trava de execução PostgreSQL; fila única no PGlite; alteração de arquivo já aplicado aborta|`Database.migrate()` antes do servidor aceitar requisições|Reexecução e checksum divergente testados|

**Delimitação clínica:** “encaminhado à triagem” é estado operacional. Não grava classificação de risco, não decide prioridade clínica e não usa protocolo não homologado. “Alta operacional” encerra o episódio/alocação; não produz resumo clínico, prescrição de alta ou assinatura. Ocupação não constitui decisão clínica autônoma. O perfil responsável por confirmar higienização precisa ser ajustado com a instituição antes de uso real.

## Máquina de estados
- Aberto → check-in ou cancelado.
- Check-in → encaminhamento à triagem, espera ou cancelado.
- Triagem → espera (somente perfil assistencial habilitado) ou cancelado.
- Espera → em atendimento (perfil assistencial) ou cancelado.
- Em atendimento → observação ou alta operacional.
- Observação → em atendimento ou alta operacional.
- Em atendimento/observação → internado pela ocupação autorizada do leito.
- Internado → alta operacional; a transferência mantém internação.
- Finalizados/cancelados não podem retornar por alteração direta.

Leito: disponível → reservado/ocupado/bloqueado; reservado → ocupado ou disponível por cancelamento; ocupado → higienização após transferência/alta; higienização → disponível com confirmação autorizada; bloqueado → disponível por desbloqueio. Reserva não tem expiração automática nesta versão: deve ser revisada e cancelada explicitamente.

## Modelo físico novo
| Tabela | Campos e referências | Restrições / retenção |
|---|---|---|
|rooms|id, unit_id, sector_id, name, active|Nome único por unidade; FK setor/unidade; sem exclusão pela API|
|schedules|id, unit_id, room_id, professional_id, name, specialty, slot_minutes, starts_at, ends_at, active|FK sala/unidade e vínculo profissional; início < fim; índice unidade/período|
|schedule_blocks|id, unit_id, schedule_id, starts_at, ends_at, reason, created_by|FK composta agenda/unidade; intervalos válidos; sem remoção nesta versão|
|appointments|id, unit_id, patient_id, schedule_id, starts_at, ends_at, status, version, created_at, created_by|FKs compostas paciente/agenda; trigger serializa disponibilidade por unidade; índices agenda/horário e paciente|
|encounters|id, unit_id, patient_id, appointment_id, sector_id, modality, status, version, opened_at, stage_at, ended_at, created_by|Um episódio por consulta; FKs por unidade; índice unidade/status/etapa|
|beds|id, unit_id, sector_id, code, state, version|Código único por unidade; FK setor/unidade|
|bed_allocations|id, unit_id, bed_id, encounter_id, status, started_at, ended_at, created_by|Índices únicos parciais: uma alocação reservada/ocupada por leito e por episódio|
|operational_events|id, unit_id, entity_type, entity_id, action, from_state, to_state, reason, actor_id, created_at, correlation_id, details|Append-only via trigger; índice contexto/recurso/data; guarda horários/referências anteriores, sem exclusão pela API|

Prazos de retenção continuam dependentes da validação institucional; nenhuma rotina de expurgo desses registros foi adicionada. O histórico operacional não é substituto de prontuário versionado.

## API adicional
Mesmos cookies, origem permitida, `X-Requested-With`, `X-Unit-Id` e `Idempotency-Key` da fundação. Paginação `page`, `size` (máximo 50). Busca nominal só em endpoints autorizados; nenhuma identidade nominal é retornada ao perfil técnico pelos leitos.

| Método / rota | Corpo ou filtro principal |
|---|---|
|GET /resources|Salas e profissionais habilitados da unidade|
|POST /rooms|`name, sector_id`|
|GET /schedules|`page,size`|
|POST /schedules|`name,specialty,room_id,professional_id,slot_minutes,starts_at,ends_at`|
|GET /schedules/:id/blocks|Agenda da unidade|
|POST /schedules/:id/blocks|`starts_at,ends_at,reason`|
|GET /appointments|`q,status,page,size`|
|POST /appointments|`patient_id,confirmed_patient_id,schedule_id,starts_at`|
|PATCH /appointments/:id|`action=confirm/cancel/no_show/reschedule,version,reason,starts_at?,schedule_id?`|
|GET /encounters|`q,status,page,size`; status `active` reúne não encerrados|
|POST /encounters|`patient_id,confirmed_patient_id,sector_id,modality,appointment_id?`|
|POST /encounters/:id/transition|`to,version,reason,sector_id?`|
|GET /operations/:type/:id/history|type `appointment` ou `encounter`; paginação|
|GET /beds|`status,page,size`|
|POST /beds|`code,sector_id`|
|POST /beds/:id/allocate|`encounter_id,mode=reserve/occupy/transfer,version,reason`|
|POST /beds/:id/state|`action=block/unblock/clean/cancel_reservation,version,reason`|
|GET /operations/metrics|Contagens, fórmula, fonte e atualização da unidade|

Os instantes da API exigem ISO 8601 com fuso. Formulários convertem a hora digitada no fuso da unidade; não dependem do fuso do computador. Horários inexistentes/ambíguos na mudança de horário de verão são recusados com mensagem, sem escolher um instante silenciosamente.

## Manual do novo fluxo
1. Administração técnica: configure os serviços ambulatoriais/internação necessários. Em Agendamentos, crie sala e disponibilidade; em Leitos, cadastre leitos. Não é necessário conceder acesso a pacientes à TI.
2. Recepção: selecione a agenda, localize a pessoa e confira nome/nascimento/identificador; salve a consulta. Reagende/cancele com justificativa quando necessário.
3. No horário de recepção, clique Fazer check-in. Confira paciente e setor; o episódio é criado junto com a alteração da consulta. Alternativamente abra episódio sem consulta prévia em Recepção e check-in.
4. Em Filas/Atendimentos, use Mudar etapa para encaminhar. Médico/enfermagem movimentam para espera/atendimento/observação conforme suas permissões. Isto é demonstração operacional, ainda sem prontuário.
5. Em Leitos ou Internações e movimentações, selecione episódio e reserve/ocupe/transfira. Para transferir, escolha o leito destino disponível. A origem passa para higienização.
6. Perfil assistencial: encerre o episódio com alta operacional e justificativa; confirme higienização para liberar o leito.
7. Consulte Histórico no episódio/consulta e os indicadores no Painel gerencial.

`npm run seed:operations` é opcional, exclusivamente demonstrativo. Acrescenta setor, sala, três leitos e uma disponibilidade futura; habilita ambulatório/internação na Unidade Central fictícia, preservando serviços já marcados. Não recria pessoas, usuários ou credenciais. Não execute sobre uma base real. Com a aplicação parada, pode ser usado para preparar uma demonstração nova.

## Verificação e limites
**46 testes automatizados aprovados:** 25 da base anterior e 21 novos de operação/migração/fuso. Relatórios: `testes-etapa2.txt` e `build-etapa2.txt`. As disputas HTTP foram executadas no PGlite com fila única; restrições SQL também foram exercitadas. Isso não substitui um teste multiprocesso no PostgreSQL em rede. O ambiente não tem Docker instalado; compose/pg_dump/pg_restore continuam sem execução.

Foi acrescentado ensaio de restauração de cópia offline PGlite em diretório isolado, seguido da migração aditiva e comparação de identificadores e hashes anteriores. O resultado está em `restauracao-local.json`; não estabelece RPO/RTO de produção.

## Pendências preservadas
Esta entrega implementa o núcleo operacional da etapa 2, sem declarar toda a etapa concluída. Permanecem: agendas recorrentes/calendários/feriados, lista de espera, encaixes autorizados, encerramento/desbloqueio de intervalos de agenda, troca de agenda pela UI, mesclagem de pessoas, documentos e autorizações, revisão clínica de encaminhamento/alta, reserva com expiração e gestão de tarefas de higienização. A API de falta posterior ao horário existe, mas precisa de um caso automatizado dedicado.

Etapas 3–7 continuam no escopo original: prontuário e retificações, risco com protocolo validado, exames/resultados, prescrição, validação farmacêutica/dispensação/administração, lotes e estoque, contas/tabelas/recebimentos/estornos, apoio, relatórios, integrações e homologação. Não foram adicionadas telas que finjam executar essas funções.
