# Tutorial rápido — Aurora Hospital

## 1. Entrar
Abra **http://127.0.0.1:3001**.

- E-mail: **ti@demo.local**
- Senha: consulte **ACESSO-LOCAL.md** nesta pasta.
- **MFA desativado neste modo demonstrativo.** Basta e-mail e senha.

O T.I tem acesso a todas as funções já implementadas. Funções futuras continuam com o aviso “Planejado · Não implementado”.

Este endereço usa uma cópia separada do backup validado, com 8 pacientes e 14 contas. Os exemplos clínicos mais recentes da outra base não fazem parte desta cópia. O endereço antigo, porta 3000, continua separado; prefira 3001 para estes testes.

## 2. Conhecer os menus
Os sete módulos ficam na lateral. Clique no nome para abrir seus submenus. No cabeçalho, escolha a unidade e o setor em que deseja trabalhar.

| Módulo | O que explorar agora |
|---|---|
|Gerenciamento|Painel, indicadores básicos, unidades/setores, leitos, usuários/permissões, configurações e auditoria.|
|Recepção/Pacientes|Pacientes, agendamentos, check-in, filas, atendimentos e movimentação de leitos.|
|Apoio|Menus previstos; fluxos ainda pendentes.|
|Faturamento|Menus previstos; contas e faturamento ainda pendentes.|
|Administrativo|Menus previstos; financeiro e rotinas administrativas ainda pendentes.|
|Clínicos|Prontuário e Evoluções: documentos, alergias e sinais vitais.|
|Suprimentos/Estoque|Menus previstos; movimentação de estoque ainda pendente.|

## 3. Cadastrar uma pessoa fictícia
**Recepção/Pacientes → Cadastro de pacientes → Novo paciente**.

Preencha nome e nascimento. Se os dados ainda não forem conhecidos, marque identificação provisória. CPF e CNS são opcionais. Clique em **Salvar cadastro**. A confirmação informa que o cadastro foi salvo no servidor. Use a busca para encontrá-lo novamente.

## 4. Abrir um atendimento
**Recepção/Pacientes → Atendimentos → Abrir atendimento**.

Busque a pessoa, clique no resultado, confira seus identificadores e marque a confirmação. Escolha setor/modalidade e confirme. Depois use **Mudar etapa** para realizar check-in e encaminhar para triagem ou espera. Se a modalidade estiver desativada, habilite o serviço em **Gerenciamento → Configurações**.

## 5. Registrar a parte clínica
**Clínicos → Prontuário → Abrir registro clínico**, na linha da pessoa correta.

- **Registrar avaliação de alergias:** escolha a situação; em “Alergias registradas”, adicione substância e reação.
- **Registrar sinal vital:** escolha a medição, informe valor, horário e justificativa.
- **Novo documento clínico:** escolha tipo, escreva e salve o rascunho.
- **Finalizar documento:** confira o registro e informe motivo. Depois, correções usam **Retificar preservando original**.
- **Histórico de versões:** mostra conteúdo anterior, autor, motivo e horário.

O T.I pode explorar esses recursos sem adesão assistencial neste modo. Seus documentos aparecem como **T.I · Demonstração**, sem simular a categoria médica. Finalização não é assinatura digital. Resumo de alta é documento e não encerra sozinho o atendimento.

## 6. Agendas e leitos
Em **Agendamentos**, use os recursos/salas e disponibilidades de agenda quando cadastrados. Se não houver, configure os recursos pelo próprio módulo com o perfil T.I. Confira paciente e horário antes de confirmar; conflitos são bloqueados pelo sistema.

Em **Internações e movimentações**, reserve/ocupe/transfira leitos disponíveis. Ocupar exige episódio em atendimento, observação ou internação. Ao dar alta operacional, leitos usados passam para higienização; conclua a higienização para liberá-los.

## 7. Dicas rápidas
- Use apenas dados fictícios.
- Confira paciente, nascimento, identificador e atendimento antes de gravar.
- Se aparecer conflito de versão, recarregue e confira os dados atuais.
- As permissões continuam respeitando a unidade selecionada.
- Os botões de funções futuras não simulam gravações.
- Para sair: ícone do perfil no cabeçalho → Sair da sessão.

## Se precisar iniciar novamente
Execute **INICIAR-TI-DEMO.ps1**, nesta pasta. Se a aplicação já estiver aberta, apenas acesse o link; não abra outra instância do banco. Para parar um servidor iniciado nesse terminal, pressione Ctrl+C e aguarde seu encerramento. O modo facilitado só se aplica à demonstração.
