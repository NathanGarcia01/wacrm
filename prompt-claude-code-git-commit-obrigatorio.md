# Instrução permanente: commit + push no GitHub ao final de cada tarefa

## Contexto

Perdemos todo o trabalho de customização do projeto porque as alterações feitas pelo Claude Code nunca foram commitadas e enviadas pro GitHub. O computador onde o projeto estava foi perdido e o código ficou só local.

A partir de agora, **toda tarefa concluída deve obrigatoriamente terminar com um commit e push pro GitHub**. Isso garante que:
1. O código fica salvo na nuvem mesmo se o computador falhar
2. O Render detecta o push e faz deploy automático em produção
3. Nunca mais perdemos trabalho

## Regra obrigatória para todas as tarefas

Ao final de **qualquer** tarefa (seja ela grande ou pequena — uma tradução, um componente novo, uma correção de bug), você DEVE executar obrigatoriamente:

```bash
cd "C:\Users\natha\wacrm"
git add -A
git commit -m "descrição clara do que foi feito"
git push origin main
```

### Formato da mensagem de commit

Use mensagens claras e descritivas em português, indicando o que foi feito:
- `feat: adiciona painel admin com MRR e churn`
- `fix: corrige bug de dados na tabela do admin`
- `style: traduz interface para português`
- `feat: adiciona trigger first_outbound_message`

### Quando fazer o commit

- **Ao final de cada tarefa concluída** — não espere acumular várias tarefas
- **Antes de iniciar uma nova tarefa diferente** — garante que o estado atual está salvo
- **Se uma tarefa for grande** (muitos arquivos), pode fazer commits intermediários por seção

### Se o push falhar

Se o `git push` falhar (ex: conflito, autenticação), avise imediatamente e resolva antes de continuar qualquer outra tarefa. Nunca deixe código não commitado acumulando.

## Configuração inicial do Git neste computador novo

Antes de fazer o primeiro commit, configure o Git com identidade:

```bash
git config user.name "Nathan Garcia"
git config user.email "nathan.gaarcia01@gmail.com"
```

Se pedir autenticação no push (usuário/senha do GitHub), use um Personal Access Token (PAT) em vez da senha. O Nathan pode gerar um em: GitHub → Settings → Developer Settings → Personal Access Tokens → Generate new token (marcar permissão `repo`).

## Resumo

Nunca termine uma sessão de trabalho sem rodar `git add -A && git commit -m "..." && git push origin main`. Isso é tão importante quanto o código em si.
