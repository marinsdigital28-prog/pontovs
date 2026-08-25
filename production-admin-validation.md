# Validação do painel administrativo

Fonte consultada: https://ponto.marinsdistemas.xyz/admin

Em 25 de agosto de 2026, o acesso sem sessão autenticada redirecionou para `/auth/signin?callbackUrl=/admin`, indicando que a proteção de autenticação está ativa. O print enviado pelo usuário mostrou uma exceção 500 após o carregamento do painel autenticado. O clone local foi ajustado para tratar falhas de consultas secundárias sem derrubar a página inteira; é necessário publicar/redeploy e testar com uma sessão de gestor para confirmar o resultado em produção.
