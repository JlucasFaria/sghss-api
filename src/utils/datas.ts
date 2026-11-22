// Datas no fuso da VidaPlus. O Brasil não tem horário de verão desde 2019,
// então o deslocamento de Brasília é fixo em UTC−3.
const FUSO_BRASILIA = "-03:00";
const HORAS_ATRAS_DO_UTC = 3;
const DIA_MS = 24 * 60 * 60 * 1000;

// Início (inclusivo) e fim (exclusivo) de um dia AAAA-MM-DD no horário de Brasília
export const intervaloDoDia = (data: string) => {
  const inicio = new Date(`${data}T00:00:00${FUSO_BRASILIA}`);
  const fim = new Date(inicio.getTime() + DIA_MS);
  return { inicio, fim };
};

// Data de hoje (AAAA-MM-DD) no horário de Brasília. Usar a data UTC erraria o dia
// entre 21h e meia-noite, quando o UTC já está no dia seguinte.
export const dataDeHoje = (agora = new Date()) =>
  new Date(agora.getTime() - HORAS_ATRAS_DO_UTC * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

// Soma dias a uma data AAAA-MM-DD; devolve Date à meia-noite UTC (formato das colunas date)
export const somarDias = (data: string, dias: number) =>
  new Date(new Date(data).getTime() + dias * DIA_MS);

// "22/11/2026 às 14:30" no horário de Brasília, para mensagens ao usuário
export const formatarDataHora = (data: Date) => {
  const iso = new Date(
    data.getTime() - HORAS_ATRAS_DO_UTC * 60 * 60 * 1000,
  ).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} às ${iso.slice(11, 16)}`;
};
