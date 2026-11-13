---
name: agent-browser
description: Test or inspect the darkroom web UI in a real browser with agent-browser (installed via mise). Use when asked to check, click through, screenshot or debug the UI, verify a UI change works, or reproduce a UI bug.
allowed-tools: Bash(agent-browser:*)
---

# agent-browser for darkroom

1. Load the usage guide that matches the installed CLI version before running any command:
   `agent-browser skills get core` (add `--full` for the complete command reference).
   For exploratory bug hunting also load `agent-browser skills get dogfood`.

2. Never test against the user's real data or with paid API calls. Start the mock and a separate server with an
   empty data folder (both in the background, remember their PIDs):

   ```bash
   pnpm build            # the server serves the built UI
   pnpm mock             # local stand-in for OpenRouter on port 5299
   DARKROOM_HOME=$(mktemp -d) PORT=5199 OPENROUTER_API_KEY=test OPENROUTER_BASE=http://127.0.0.1:5299/api/v1 pnpm start
   ```

   - `DARKROOM_HOME` keeps refs/, out/, voices/ and .env of the repository untouched.
   - Mock models: `mock/image`, `mock/image-slow` (5 s, for cancel tests), `mock/image-error`, `mock/tts`,
     `mock/clone`, `mock/lyria`. Only use the real API when the user asks for it.
   - Open http://localhost:5199. Only stop processes you started yourself (by PID), never the user's server on 5177.

3. Use a named session (`--session darkroom-test`) and close it when done. Screenshots go to the scratchpad, not the repository.
