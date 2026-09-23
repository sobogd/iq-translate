<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->



# Secrets handling — global hard rule

Applies in every project and every agent session (this repo included). Full policy: `~/work/AGENTS.md`.

- **Never** pass secrets into chat or agent contexts: no `.env` values, GitHub PATs/tokens,
  SMTP keys/passwords, SSH keys or DB credentials in chat messages, prompts, subagent tasks,
  or tool arguments that get logged.
- **Never** hand a token/API key to an agent to hold or forward, and never write secret values
  into files that could be committed. Never dump secret-bearing files (`~/work/.env`,
  `<project>/.env`) with file-reading tools — that leaks them into the transcript.
- Read secrets **only via local scripts**, feeding the consuming tool straight through stdin
  (`node --env-file=.env …`, `gh secret set` / `gh auth login --with-token` from stdin,
  nodemailer tests, …). Never echo the value.
- When verifying a secret, report only metadata: set/not set, length, prefix class
  (`github_pat_`, `xsmtpsib-`), booleans.

Personal token store: `~/work/.env` (mode 600, outside git) — keys `GH_SOBOGD`,
`GH_BSOKOLOV_TANGEM`. Global copies of this rule: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`.

## Git Token — Universal Helper

**Всегда используйте скрипт `/Users/sobogd/work/.git-token.sh`** перед операциями с GitHub.

```bash
source /Users/sobogd/work/.git-token.sh
gh workflow run deploy.yml
```

Скрипт автоматически определяет проект и подставляет правильный токен:
- **Тангем проекты** (`/tangem/`, `/tangem-checkout-web/`) → `GH_BSOKOLOV_TANGEM`
- **Все остальные** → `GH_SOBOGD`

**Никогда не используйте `gh auth login` без токена** — это активирует дефолтную учётку
(`sobogd`), у которой токен невалиден для Tangem.

If you see authentication errors with `gh`, run the script first!
