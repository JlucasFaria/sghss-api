import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import { env } from "../../config/env";
import { logger } from "../logger";

// Fora do ambiente de testes o logger escreve no console; aqui ele é ligado
// temporariamente para verificar o formato das linhas (RNF09)
const ambienteOriginal = env.NODE_ENV;
const log = spyOn(console, "log").mockImplementation(() => {});
const erro = spyOn(console, "error").mockImplementation(() => {});

const ultimaLinha = (spy: typeof log) =>
  JSON.parse(String(spy.mock.calls.at(-1)?.[0])) as Record<string, unknown>;

beforeEach(() => {
  env.NODE_ENV = "development";
  log.mockClear();
  erro.mockClear();
});

afterEach(() => {
  env.NODE_ENV = ambienteOriginal;
});

// Os outros arquivos de teste rodam no mesmo processo e usam o console real
afterAll(() => {
  log.mockRestore();
  erro.mockRestore();
});

describe("logger", () => {
  it("escreve uma linha JSON com nível, mensagem, data e campos extras", () => {
    logger.info("requisição concluída", { status: 200, requestId: "abc" });

    const linha = ultimaLinha(log);
    expect(linha).toMatchObject({
      level: "info",
      message: "requisição concluída",
      status: 200,
      requestId: "abc",
    });
    expect(new Date(String(linha.timestamp)).toString()).not.toBe(
      "Invalid Date",
    );
  });

  it("não deixa campos extras sobrescreverem os campos fixos", () => {
    logger.warn("aviso", { level: "info", message: "falsa" });

    expect(ultimaLinha(log)).toMatchObject({ level: "warn", message: "aviso" });
  });

  it("envia erros para o console de erro", () => {
    logger.error("falha", { code: "X" });

    expect(log).not.toHaveBeenCalled();
    expect(ultimaLinha(erro)).toMatchObject({ level: "error", code: "X" });
  });

  it("fica em silêncio no ambiente de testes", () => {
    env.NODE_ENV = "test";

    logger.info("não aparece");

    expect(log).not.toHaveBeenCalled();
  });
});
