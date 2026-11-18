# Requisitos do SGHSS — VidaPlus

Levantamento dos requisitos funcionais (RF) e não funcionais (RNF) do Sistema de Gestão Hospitalar e de Serviços de Saúde (SGHSS) da VidaPlus, derivados do estudo de caso. É a base do diagrama de casos de uso, do DER, dos endpoints da API e do plano de testes (ver [rastreabilidade](rastreabilidade.md)).

## Contexto e recorte

A VidaPlus administra hospitais, clínicas de bairro, laboratórios e equipes de home care. O SGHSS centraliza cinco eixos: atendimento de pacientes, gestão de profissionais de saúde, administração hospitalar, telemedicina e segurança/compliance.

Este projeto tem ênfase **Back-end**: o entregável é uma API REST. O recorte implementado cobre os fluxos centrais de cada eixo — autenticação e controle de acesso, pacientes, profissionais e agenda, consultas e exames, prontuário e receitas, telemedicina, notificações, auditoria/LGPD, leitos e internações e relatórios. Requisitos marcados como **Opcional** foram analisados e modelados, mas só serão implementados se houver tempo; caso contrário, ficam documentados como evolução futura.

## Perfis de usuário

| Perfil     | Descrição                                                                        |
| ---------- | -------------------------------------------------------------------------------- |
| PACIENTE   | Titular dos dados; agenda consultas, acessa teleconsultas e o próprio histórico. |
| MEDICO     | Profissional com CRM; atende, registra prontuário e emite receitas.              |
| ENFERMEIRO | Profissional com COREN; registra evoluções e acompanha internações.              |
| TECNICO    | Técnico de enfermagem; apoia o atendimento e o registro de evoluções.            |
| ADMIN      | Administrador da VidaPlus; gerencia cadastros, unidades, leitos e relatórios.    |

Sistemas externos que interagem com a API: **Farmácia** (valida receitas) e **Provedor de vídeo** (hospeda as salas de teleconsulta).

## Requisitos funcionais

Prioridade: **Alta** (essencial ao fluxo central), **Média** (agrega valor ao fluxo), **Baixa** (complementar). Escopo: **Núcleo** (implementado) ou **Opcional**.

| ID   | Descrição                                                                                                                         | Tipo      | Prioridade | Módulo                   | Escopo   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ------------------------ | -------- |
| RF01 | Permitir que o paciente crie a própria conta (autocadastro) informando dados pessoais e aceitando o termo de uso de dados.        | Funcional | Alta       | Autenticação             | Núcleo   |
| RF02 | Autenticar usuários por e-mail e senha, emitindo um token de acesso com validade limitada.                                        | Funcional | Alta       | Autenticação             | Núcleo   |
| RF03 | Permitir que o usuário autenticado consulte os próprios dados de acesso e perfil.                                                 | Funcional | Média      | Autenticação             | Núcleo   |
| RF04 | Restringir cada operação aos perfis autorizados (ADMIN, MEDICO, ENFERMEIRO, TECNICO, PACIENTE).                                   | Funcional | Alta       | Autenticação             | Núcleo   |
| RF05 | Cadastrar, listar, consultar, atualizar e inativar unidades de atendimento (hospital, clínica, laboratório, home care).           | Funcional | Alta       | Unidades                 | Núcleo   |
| RF06 | Cadastrar, listar, consultar, atualizar e inativar profissionais de saúde, com registro de conselho, especialidade e unidade.     | Funcional | Alta       | Profissionais            | Núcleo   |
| RF07 | Permitir que o profissional abra e bloqueie horários na própria agenda e liste a agenda de um dia.                                | Funcional | Alta       | Profissionais            | Núcleo   |
| RF08 | Permitir que o administrador liste (paginado), busque por CPF, consulte, atualize e inative pacientes.                            | Funcional | Alta       | Pacientes                | Núcleo   |
| RF09 | Permitir que o paciente consulte e atualize o próprio cadastro.                                                                   | Funcional | Média      | Pacientes                | Núcleo   |
| RF10 | Exibir o histórico clínico (consultas, exames, prescrições e internações): o paciente vê o seu; o profissional, o de quem atende. | Funcional | Alta       | Pacientes                | Núcleo   |
| RF11 | Agendar consulta presencial ou teleconsulta em horário livre da agenda do profissional, sem conflito de horário.                  | Funcional | Alta       | Consultas e exames       | Núcleo   |
| RF12 | Cancelar e reagendar consultas, respeitando uma antecedência mínima.                                                              | Funcional | Alta       | Consultas e exames       | Núcleo   |
| RF13 | Listar consultas por paciente e por profissional, com filtros de data e status.                                                   | Funcional | Média      | Consultas e exames       | Núcleo   |
| RF14 | Agendar exames e registrar seus resultados.                                                                                       | Funcional | Média      | Consultas e exames       | Núcleo   |
| RF15 | Permitir que o profissional registre evoluções no prontuário vinculadas a uma consulta.                                           | Funcional | Alta       | Prontuário e receitas    | Núcleo   |
| RF16 | Emitir receita digital com itens e posologia, gerando um código de verificação único.                                             | Funcional | Alta       | Prontuário e receitas    | Núcleo   |
| RF17 | Permitir que a farmácia confira a autenticidade de uma receita pelo código de verificação, sem login.                             | Funcional | Média      | Prontuário e receitas    | Núcleo   |
| RF18 | Criar a sala de vídeo de uma teleconsulta junto ao provedor de vídeo, com acesso temporário.                                      | Funcional | Alta       | Telemedicina             | Núcleo   |
| RF19 | Permitir a entrada e o encerramento da teleconsulta apenas pelo paciente e pelo profissional da consulta, na janela de horário.   | Funcional | Alta       | Telemedicina             | Núcleo   |
| RF20 | Gerar notificações para o paciente quando uma consulta for agendada, cancelada ou estiver próxima (lembrete).                     | Funcional | Média      | Notificações             | Núcleo   |
| RF21 | Listar as notificações do usuário e marcá-las como lidas.                                                                         | Funcional | Baixa      | Notificações             | Núcleo   |
| RF22 | Registrar trilha de auditoria das ações sensíveis (quem, o quê, quando e de qual IP).                                             | Funcional | Alta       | Segurança e compliance   | Núcleo   |
| RF23 | Permitir que o administrador consulte os registros de auditoria, filtrando por usuário, ação e período.                           | Funcional | Média      | Segurança e compliance   | Núcleo   |
| RF24 | Registrar o consentimento do paciente para o tratamento de dados (finalidade, data e versão do termo).                            | Funcional | Alta       | Segurança e compliance   | Núcleo   |
| RF25 | Permitir que o paciente exporte os próprios dados em formato estruturado (portabilidade).                                         | Funcional | Média      | Segurança e compliance   | Núcleo   |
| RF26 | Anonimizar os dados pessoais do paciente a pedido do titular, preservando os registros clínicos de guarda obrigatória.            | Funcional | Baixa      | Segurança e compliance   | Opcional |
| RF27 | Cadastrar e gerenciar leitos por unidade e ala, com status (livre, ocupado, manutenção).                                          | Funcional | Alta       | Administração hospitalar | Núcleo   |
| RF28 | Internar paciente (ocupando um leito), transferir de leito e dar alta (liberando o leito).                                        | Funcional | Alta       | Administração hospitalar | Núcleo   |
| RF29 | Gerar relatórios gerenciais de ocupação de leitos e de consultas por período e unidade.                                           | Funcional | Média      | Administração hospitalar | Núcleo   |
| RF30 | Controlar suprimentos e movimentações de estoque, com alerta de estoque mínimo.                                                   | Funcional | Baixa      | Administração hospitalar | Opcional |
| RF31 | Registrar lançamentos financeiros (receitas e despesas) e apresentar um resumo por período e unidade.                             | Funcional | Baixa      | Administração hospitalar | Opcional |

## Requisitos não funcionais

| ID    | Descrição                                                                                                                                                                          | Tipo                       | Prioridade | Módulo         | Escopo |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------- | -------------- | ------ |
| RNF01 | Criptografar em repouso os dados sensíveis (CPF, telefone e conteúdo do prontuário) com AES-256-GCM; armazenar senhas com hash argon2id; exigir HTTPS em produção.                 | Segurança                  | Alta       | Transversal    | Núcleo |
| RNF02 | Autenticar por token JWT de curta duração e limitar tentativas de login para mitigar força bruta.                                                                                  | Segurança                  | Alta       | Autenticação   | Núcleo |
| RNF03 | Validar toda entrada na borda da API (tipos, formatos, CPF, rejeição de HTML/script), limitar o tamanho do corpo e enviar headers de segurança e CORS restrito.                    | Segurança                  | Alta       | Transversal    | Núcleo |
| RNF04 | Atender à LGPD: coletar só o necessário, registrar consentimento, garantir os direitos do titular e não expor dados pessoais em logs nem em mensagens de erro.                     | Conformidade (LGPD)        | Alta       | Transversal    | Núcleo |
| RNF05 | Manter os registros de auditoria somente para inclusão (sem edição ou exclusão pela API).                                                                                          | Conformidade (auditoria)   | Alta       | Segurança      | Núcleo |
| RNF06 | Suportar múltiplas unidades e escalar horizontalmente: API sem estado de sessão (JWT), dados segregados por unidade.                                                               | Escalabilidade             | Alta       | Transversal    | Núcleo |
| RNF07 | Responder às consultas críticas (agenda, consultas e prontuário) com p95 abaixo de 500 ms e taxa de erro abaixo de 1% sob carga de teste; listagens sempre paginadas.              | Desempenho                 | Alta       | Transversal    | Núcleo |
| RNF08 | Disponibilidade mínima de 99,5%: verificação de saúde (liveness e readiness com o banco), reinício automático do serviço e backup diário do banco com retenção.                    | Disponibilidade            | Alta       | Infraestrutura | Núcleo |
| RNF09 | Registrar logs estruturados em JSON com identificador de requisição, permitindo rastrear falhas sem registrar dados pessoais.                                                      | Observabilidade            | Média      | Transversal    | Núcleo |
| RNF10 | Seguir padrões que permitam front-ends acessíveis (WCAG): mensagens de erro claras em português, erro indicado por campo, respostas em formato consistente e contrato documentado. | Acessibilidade/Usabilidade | Média      | Transversal    | Núcleo |
| RNF11 | Expor contrato OpenAPI 3 com Swagger UI e integrar serviços externos (provedor de vídeo) por meio de uma interface substituível.                                                   | Interoperabilidade         | Média      | Transversal    | Núcleo |
| RNF12 | Garantir manutenibilidade: TypeScript estrito, lint e formatação padronizados, testes automatizados em pipeline de CI e cobertura mínima de 80% nas regras de negócio.             | Manutenibilidade           | Média      | Transversal    | Núcleo |
| RNF13 | Empacotar a API e o banco em contêineres Docker para implantação reproduzível em qualquer ambiente.                                                                                | Portabilidade              | Baixa      | Infraestrutura | Núcleo |

## Decisões sobre ambiguidades do estudo de caso

- **Acessibilidade (WCAG) em uma API (RNF10).** O estudo de caso pede "interface amigável e responsiva, com padrões W3C/WCAG", mas a ênfase é Back-end e não há interface visual. A interpretação adotada é que a API deve viabilizar front-ends acessíveis: erros com mensagem compreensível em português e indicação do campo inválido (permitindo que leitores de tela anunciem o problema ao lado do campo), formato de resposta previsível (`{ data }` / `{ error }`), códigos HTTP corretos e contrato OpenAPI que documenta cada campo. A conformidade visual (contraste, navegação por teclado) fica a cargo do front-end.
- **Videochamadas seguras (RF18, RF19).** Implementar transmissão de vídeo não faz parte de uma API de gestão. A API cria a sala no provedor e controla quem entra e quando; o provedor é acessado por uma interface com um adaptador simulado, que pode ser trocado por um real (ex.: Jitsi, Twilio) sem alterar as regras de negócio.
- **Notificações (RF20).** O estudo de caso não define o canal. As notificações são persistidas e consultadas pela API; o envio por e-mail, SMS ou push é documentado como integração futura.
- **Relatórios financeiros e suprimentos (RF30, RF31).** Pertencem ao eixo administrativo, mas não ao fluxo clínico central. São modelados no banco e tratados como opcionais, conforme a diretriz do material de que "um módulo bem feito vale mais que um sistema inteiro mal feito".
- **Exclusão de dados clínicos.** Prontuários têm guarda obrigatória (CFM). Por isso, `DELETE` de pacientes e profissionais faz inativação lógica, e a anonimização (RF26) preserva os registros clínicos.
- **Validação de receita pela farmácia (RF17).** É o único acesso público de leitura; expõe apenas os dados necessários para conferir a autenticidade, sem dados clínicos completos do paciente.
