// Varredura de segurança da API com o OWASP ZAP (Docker), no modo baseline: o ZAP
// importa o contrato OpenAPI, chama cada rota e analisa as respostas de forma passiva
// (cabeçalhos, cookies, vazamento de informação), sem enviar ataques.
// Atenção: as rotas são chamadas com os exemplos do contrato, inclusive POST, PUT e
// DELETE. Use só o banco de desenvolvimento e rode "bun run db:seed" depois.
// Execução: bun run test:seguranca (API rodando, banco com o seed). Veja tests/README.md.
const API_LOCAL = process.env.API_URL ?? "http://localhost:3000";
// Endereço da API visto de dentro do container do ZAP
const ALVO = process.env.ZAP_ALVO ?? "http://host.docker.internal:3000";
// Usuário fictício do seed (somente desenvolvimento)
const EMAIL = process.env.ZAP_EMAIL ?? "admin@vidaplus.example";
const SENHA = process.env.ZAP_SENHA ?? "Vidaplus@2026";
const IMAGEM = "ghcr.io/zaproxy/zaproxy:2.17.0";

// Token do ADMIN: sem ele, as rotas protegidas responderiam só 401 e o ZAP
// analisaria apenas as respostas de erro
const login = await fetch(`${API_LOCAL}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, senha: SENHA }),
});
if (!login.ok) {
  console.error(
    `Login falhou (${login.status}). A API está rodando com o seed?`,
  );
  process.exit(1);
}
const { data } = (await login.json()) as { data: { token: string } };

// A pasta desta varredura é montada no container: o ZAP lê as regras e grava os relatórios nela
const pasta = import.meta.dir;
const zap = Bun.spawn(
  [
    "docker",
    "run",
    "--rm",
    "--add-host=host.docker.internal:host-gateway",
    // Cabeçalho acrescentado pelo ZAP em todas as requisições
    "-e",
    `ZAP_AUTH_HEADER_VALUE=Bearer ${data.token}`,
    "-v",
    `${pasta}:/zap/wrk:rw`,
    IMAGEM,
    "zap-api-scan.py",
    "-t",
    `${ALVO}/openapi.json`,
    "-f",
    "openapi",
    "-S",
    "-c",
    "regras.conf",
    "-r",
    "relatorio-zap.html",
    "-J",
    "relatorio-zap.json",
  ],
  { stdout: "inherit", stderr: "inherit" },
);

// 0 = sem alertas; 1 = alguma regra marcada como FAIL; 2 = só avisos (WARN)
const codigo = await zap.exited;
console.log(
  `\nRelatórios: tests/seguranca/relatorio-zap.html e relatorio-zap.json (código ${codigo})`,
);
process.exit(codigo);
