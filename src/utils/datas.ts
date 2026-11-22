// Datas no fuso da VidaPlus. O Brasil não tem horário de verão desde 2019,
// então o deslocamento de Brasília é fixo em UTC−3.
const FUSO_BRASILIA = "-03:00";

// Início (inclusivo) e fim (exclusivo) de um dia AAAA-MM-DD no horário de Brasília
export const intervaloDoDia = (data: string) => {
  const inicio = new Date(`${data}T00:00:00${FUSO_BRASILIA}`);
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { inicio, fim };
};
