-- CreateEnum
CREATE TYPE "perfil" AS ENUM ('ADMIN', 'MEDICO', 'ENFERMEIRO', 'TECNICO', 'PACIENTE');

-- CreateEnum
CREATE TYPE "tipo_unidade" AS ENUM ('HOSPITAL', 'CLINICA', 'LABORATORIO', 'HOME_CARE');

-- CreateEnum
CREATE TYPE "conselho" AS ENUM ('CRM', 'COREN');

-- CreateEnum
CREATE TYPE "status_horario" AS ENUM ('DISPONIVEL', 'RESERVADO', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "modalidade_consulta" AS ENUM ('PRESENCIAL', 'TELEMEDICINA');

-- CreateEnum
CREATE TYPE "status_consulta" AS ENUM ('AGENDADA', 'REALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "status_exame" AS ENUM ('AGENDADO', 'REALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "tipo_leito" AS ENUM ('ENFERMARIA', 'APARTAMENTO', 'UTI');

-- CreateEnum
CREATE TYPE "status_leito" AS ENUM ('LIVRE', 'OCUPADO', 'MANUTENCAO');

-- CreateEnum
CREATE TYPE "tipo_movimentacao" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "tipo_lancamento" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "tipo_notificacao" AS ENUM ('CONSULTA_AGENDADA', 'CONSULTA_CANCELADA', 'LEMBRETE_CONSULTA');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "perfil" "perfil" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidade" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "tipo" "tipo_unidade" NOT NULL,
    "endereco" VARCHAR(255) NOT NULL,
    "cidade" VARCHAR(100) NOT NULL,
    "uf" CHAR(2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paciente" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "cpf_cifrado" TEXT NOT NULL,
    "cpf_hash" CHAR(64) NOT NULL,
    "data_nascimento" DATE NOT NULL,
    "telefone_cifrado" TEXT,
    "anonimizado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profissional" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "unidade_id" UUID NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "conselho" "conselho" NOT NULL,
    "registro" VARCHAR(20) NOT NULL,
    "especialidade" VARCHAR(100),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profissional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horario_agenda" (
    "id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "status" "status_horario" NOT NULL DEFAULT 'DISPONIVEL',

    CONSTRAINT "horario_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consulta" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "horario_id" UUID NOT NULL,
    "unidade_id" UUID NOT NULL,
    "modalidade" "modalidade_consulta" NOT NULL,
    "status" "status_consulta" NOT NULL DEFAULT 'AGENDADA',
    "motivo" VARCHAR(500),
    "motivo_cancelamento" VARCHAR(500),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consulta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teleconsulta" (
    "id" UUID NOT NULL,
    "consulta_id" UUID NOT NULL,
    "provedor" VARCHAR(50) NOT NULL,
    "sala_id" VARCHAR(255) NOT NULL,
    "url_sala" VARCHAR(500) NOT NULL,
    "iniciada_em" TIMESTAMP(3),
    "encerrada_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teleconsulta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exame" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "unidade_id" UUID NOT NULL,
    "responsavel_id" UUID,
    "tipo" VARCHAR(150) NOT NULL,
    "data_hora" TIMESTAMP(3) NOT NULL,
    "status" "status_exame" NOT NULL DEFAULT 'AGENDADO',
    "resultado_cifrado" TEXT,
    "resultado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_prontuario" (
    "id" UUID NOT NULL,
    "consulta_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "conteudo_cifrado" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_prontuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescricao" (
    "id" UUID NOT NULL,
    "consulta_id" UUID NOT NULL,
    "codigo_verificacao_hash" CHAR(64) NOT NULL,
    "observacoes" VARCHAR(1000),
    "emitida_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valida_ate" DATE NOT NULL,

    CONSTRAINT "prescricao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_prescricao" (
    "id" UUID NOT NULL,
    "prescricao_id" UUID NOT NULL,
    "medicamento" VARCHAR(150) NOT NULL,
    "dosagem" VARCHAR(100) NOT NULL,
    "posologia" VARCHAR(500) NOT NULL,
    "quantidade" INTEGER NOT NULL,

    CONSTRAINT "item_prescricao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leito" (
    "id" UUID NOT NULL,
    "unidade_id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "ala" VARCHAR(100) NOT NULL,
    "tipo" "tipo_leito" NOT NULL,
    "status" "status_leito" NOT NULL DEFAULT 'LIVRE',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internacao" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "leito_id" UUID NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "admitido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alta_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suprimento" (
    "id" UUID NOT NULL,
    "unidade_id" UUID NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "unidade_medida" VARCHAR(20) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "estoque_minimo" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suprimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacao_estoque" (
    "id" UUID NOT NULL,
    "suprimento_id" UUID NOT NULL,
    "responsavel_id" UUID NOT NULL,
    "tipo" "tipo_movimentacao" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "observacao" VARCHAR(500),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacao_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamento_financeiro" (
    "id" UUID NOT NULL,
    "unidade_id" UUID NOT NULL,
    "tipo" "tipo_lancamento" NOT NULL,
    "categoria" VARCHAR(100) NOT NULL,
    "descricao" VARCHAR(255) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "competencia" DATE NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lancamento_financeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo" "tipo_notificacao" NOT NULL,
    "titulo" VARCHAR(150) NOT NULL,
    "mensagem" VARCHAR(500) NOT NULL,
    "lida_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_auditoria" (
    "id" UUID NOT NULL,
    "usuario_id" UUID,
    "acao" VARCHAR(100) NOT NULL,
    "entidade" VARCHAR(50) NOT NULL,
    "entidade_id" UUID,
    "ip" VARCHAR(45) NOT NULL,
    "detalhes" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimento_lgpd" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "finalidade" VARCHAR(255) NOT NULL,
    "versao_termo" VARCHAR(20) NOT NULL,
    "concedido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogado_em" TIMESTAMP(3),
    "ip" VARCHAR(45) NOT NULL,

    CONSTRAINT "consentimento_lgpd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "paciente_usuario_id_key" ON "paciente"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "paciente_cpf_hash_key" ON "paciente"("cpf_hash");

-- CreateIndex
CREATE UNIQUE INDEX "profissional_usuario_id_key" ON "profissional"("usuario_id");

-- CreateIndex
CREATE INDEX "profissional_unidade_id_idx" ON "profissional"("unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "profissional_conselho_registro_key" ON "profissional"("conselho", "registro");

-- CreateIndex
CREATE INDEX "horario_agenda_inicio_idx" ON "horario_agenda"("inicio");

-- CreateIndex
CREATE UNIQUE INDEX "horario_agenda_profissional_id_inicio_key" ON "horario_agenda"("profissional_id", "inicio");

-- CreateIndex
CREATE INDEX "consulta_paciente_id_status_idx" ON "consulta"("paciente_id", "status");

-- CreateIndex
CREATE INDEX "consulta_horario_id_idx" ON "consulta"("horario_id");

-- CreateIndex
CREATE INDEX "consulta_unidade_id_status_idx" ON "consulta"("unidade_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "teleconsulta_consulta_id_key" ON "teleconsulta"("consulta_id");

-- CreateIndex
CREATE INDEX "exame_paciente_id_idx" ON "exame"("paciente_id");

-- CreateIndex
CREATE INDEX "exame_unidade_id_data_hora_idx" ON "exame"("unidade_id", "data_hora");

-- CreateIndex
CREATE INDEX "exame_responsavel_id_idx" ON "exame"("responsavel_id");

-- CreateIndex
CREATE INDEX "registro_prontuario_consulta_id_idx" ON "registro_prontuario"("consulta_id");

-- CreateIndex
CREATE INDEX "registro_prontuario_autor_id_idx" ON "registro_prontuario"("autor_id");

-- CreateIndex
CREATE UNIQUE INDEX "prescricao_codigo_verificacao_hash_key" ON "prescricao"("codigo_verificacao_hash");

-- CreateIndex
CREATE INDEX "prescricao_consulta_id_idx" ON "prescricao"("consulta_id");

-- CreateIndex
CREATE INDEX "item_prescricao_prescricao_id_idx" ON "item_prescricao"("prescricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "leito_unidade_id_codigo_key" ON "leito"("unidade_id", "codigo");

-- CreateIndex
CREATE INDEX "internacao_paciente_id_idx" ON "internacao"("paciente_id");

-- CreateIndex
CREATE INDEX "internacao_leito_id_idx" ON "internacao"("leito_id");

-- CreateIndex
CREATE INDEX "suprimento_unidade_id_idx" ON "suprimento"("unidade_id");

-- CreateIndex
CREATE INDEX "movimentacao_estoque_suprimento_id_idx" ON "movimentacao_estoque"("suprimento_id");

-- CreateIndex
CREATE INDEX "movimentacao_estoque_responsavel_id_idx" ON "movimentacao_estoque"("responsavel_id");

-- CreateIndex
CREATE INDEX "lancamento_financeiro_unidade_id_competencia_idx" ON "lancamento_financeiro"("unidade_id", "competencia");

-- CreateIndex
CREATE INDEX "notificacao_usuario_id_criado_em_idx" ON "notificacao"("usuario_id", "criado_em");

-- CreateIndex
CREATE INDEX "log_auditoria_usuario_id_criado_em_idx" ON "log_auditoria"("usuario_id", "criado_em");

-- CreateIndex
CREATE INDEX "log_auditoria_acao_criado_em_idx" ON "log_auditoria"("acao", "criado_em");

-- CreateIndex
CREATE INDEX "log_auditoria_criado_em_idx" ON "log_auditoria"("criado_em");

-- CreateIndex
CREATE INDEX "consentimento_lgpd_paciente_id_idx" ON "consentimento_lgpd"("paciente_id");

-- AddForeignKey
ALTER TABLE "paciente" ADD CONSTRAINT "paciente_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissional" ADD CONSTRAINT "profissional_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissional" ADD CONSTRAINT "profissional_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horario_agenda" ADD CONSTRAINT "horario_agenda_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulta" ADD CONSTRAINT "consulta_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulta" ADD CONSTRAINT "consulta_horario_id_fkey" FOREIGN KEY ("horario_id") REFERENCES "horario_agenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulta" ADD CONSTRAINT "consulta_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teleconsulta" ADD CONSTRAINT "teleconsulta_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consulta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exame" ADD CONSTRAINT "exame_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exame" ADD CONSTRAINT "exame_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exame" ADD CONSTRAINT "exame_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "profissional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_prontuario" ADD CONSTRAINT "registro_prontuario_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consulta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_prontuario" ADD CONSTRAINT "registro_prontuario_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "profissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescricao" ADD CONSTRAINT "prescricao_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consulta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_prescricao" ADD CONSTRAINT "item_prescricao_prescricao_id_fkey" FOREIGN KEY ("prescricao_id") REFERENCES "prescricao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leito" ADD CONSTRAINT "leito_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internacao" ADD CONSTRAINT "internacao_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internacao" ADD CONSTRAINT "internacao_leito_id_fkey" FOREIGN KEY ("leito_id") REFERENCES "leito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suprimento" ADD CONSTRAINT "suprimento_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_suprimento_id_fkey" FOREIGN KEY ("suprimento_id") REFERENCES "suprimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao_estoque" ADD CONSTRAINT "movimentacao_estoque_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamento_financeiro" ADD CONSTRAINT "lancamento_financeiro_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimento_lgpd" ADD CONSTRAINT "consentimento_lgpd_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
