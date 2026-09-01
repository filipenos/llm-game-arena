# Política de segurança

## Segredos nunca são permitidos no Git

Credenciais reais nunca podem ser commitadas neste repositório, inclusive em
commits antigos, fixtures de testes, exemplos de documentação, screenshots,
arquivos gerados, artefatos de release ou logs de CI.

Isso inclui:

- tokens e chaves de API;
- senhas, cookies e credenciais de sessão;
- chaves privadas e certificados que contenham material privado;
- chaves de acesso à nuvem e strings de conexão assinadas;
- dados de clientes ou qualquer outro valor sensível de produção.

Use arquivos locais ignorados, como `cloudflare.env` e `.dev.vars`, durante o
desenvolvimento. Use GitHub Actions secrets e o gerenciador de segredos da
plataforma correspondente em CI e produção. Arquivos de exemplo devem conter
apenas valores fictícios inequívocos.

Antes de cada commit ou push:

1. Revise a lista exata de arquivos preparados e o diff staged.
2. Execute um scanner de segredos configurado para ocultar os valores
   encontrados.
3. Confirme que arquivos de credenciais continuam ignorados e não rastreados.
4. Pare diante de qualquer dúvida; nunca faça o commit para investigar depois.

## Se um segredo for exposto

Trate o histórico Git, pull requests, logs de CI, saídas de ferramentas,
screenshots e conversas como públicos. Revogue ou rotacione imediatamente a
credencial, remova-a de todos os locais afetados e do histórico Git e valide a
substituta sem exibir seu valor. Remover somente o commit mais recente não torna
uma credencial exposta segura novamente.

Relate suspeitas de vazamento de forma privada por meio do
[GitHub Security Advisories](https://github.com/filipenos/llm-game-arena/security/advisories/new).
