// Porta para o provedor de vídeo (padrão porta/adaptador): as regras de negócio da
// teleconsulta dependem só desta interface, e o adaptador pode ser trocado por um
// provedor real (ex.: Jitsi, Twilio) sem alterá-las.

export type SalaCriada = { salaId: string; urlSala: string };

export interface ProvedorVideo {
  readonly nome: string;
  criarSala(dados: {
    consultaId: string;
    inicio: Date;
    fim: Date;
  }): Promise<SalaCriada>;
  // Token de acesso temporário de um participante; não é armazenado pela API
  gerarToken(dados: {
    salaId: string;
    participanteId: string;
    expiraEm: Date;
  }): Promise<string>;
  encerrarSala(salaId: string): Promise<void>;
}

// Adaptador simulado: gera sala e token localmente, sem transmissão de vídeo.
// Com `falhar: true`, toda chamada falha como um provedor fora do ar (para testes).
export class ProvedorVideoSimulado implements ProvedorVideo {
  readonly nome = "simulado";

  constructor(private readonly opcoes: { falhar?: boolean } = {}) {}

  private verificarDisponibilidade() {
    if (this.opcoes.falhar) {
      throw new Error("Provedor de vídeo simulado fora do ar.");
    }
  }

  async criarSala(
    _dados: Parameters<ProvedorVideo["criarSala"]>[0],
  ): Promise<SalaCriada> {
    this.verificarDisponibilidade();
    const salaId = crypto.randomUUID();
    return { salaId, urlSala: `https://video.vidaplus.example/${salaId}` };
  }

  async gerarToken(
    _dados: Parameters<ProvedorVideo["gerarToken"]>[0],
  ): Promise<string> {
    this.verificarDisponibilidade();
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
      "base64url",
    );
  }

  async encerrarSala(_salaId: string): Promise<void> {
    this.verificarDisponibilidade();
  }
}

// Ponto único de troca do adaptador (configuração da aplicação ou testes)
let provedorAtual: ProvedorVideo = new ProvedorVideoSimulado();

export const provedorVideo = () => provedorAtual;

export const definirProvedorVideo = (provedor: ProvedorVideo) => {
  provedorAtual = provedor;
};
