-- AlterEnum
ALTER TYPE "tipo_notificacao" ADD VALUE 'CONSULTA_REAGENDADA';

-- AlterTable
ALTER TABLE "notificacao" ADD COLUMN     "consulta_id" UUID;

-- CreateIndex
CREATE INDEX "notificacao_consulta_id_idx" ON "notificacao"("consulta_id");

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consulta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
