// Helpers HTTP para os testes de rotas: requisições JSON e tokens por perfil
import type { Perfil } from "../../generated/prisma/client";
import { app } from "../app";
import { signToken } from "../utils/token";
import { criarPaciente, criarUsuario } from "./factories";

// Token válido para um usuário existente
export const tokenDe = (usuario: { id: string; perfil: Perfil }) =>
  signToken({ sub: usuario.id, perfil: usuario.perfil });

// Cria um usuário com o perfil e devolve o token dele
export async function autenticar(perfil: Perfil) {
  return tokenDe(await criarUsuario({ perfil }));
}

// Cria um paciente com usuário de acesso e devolve o token e o registro do paciente
export async function autenticarPaciente() {
  const usuario = await criarUsuario();
  const paciente = await criarPaciente({ usuarioId: usuario.id });
  return { token: await tokenDe(usuario), paciente };
}

// Token de um profissional criado pela factory (perfil MEDICO)
export const tokenDoProfissional = (profissional: { usuarioId: string }) =>
  tokenDe({ id: profissional.usuarioId, perfil: "MEDICO" });

export function requisitar(
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  return app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Lê o corpo JSON já tipado (evita casts repetidos em cada teste)
export const lerJson = <T>(res: Response) => res.json() as Promise<T>;
