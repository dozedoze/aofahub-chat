# aofahub-chat

Fork of [DeepSeek chat-demo](https://github.com/deepseek-ai/chat-demo) for AofaHub.

The Worker on `https://chat.aofahub.dev` is a static site. It has no secrets and does not issue API keys. Sign-in uses username/password from the my-sub-api admin; the gateway sets an HttpOnly `chat_session` cookie. Completions go to `https://aofahub.dev/anthropic/v1/skill/messages`.

## Dev

Install Node.js 22.12+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:8090. The dev server proxies API calls to `https://aofahub.dev` (set `API_ORIGIN` to a local gateway if you have one). Production builds bake in `https://aofahub.dev`.

```sh
pnpm build
pnpm deploy
```

Chat history stays in IndexedDB. Passwords are not written to localStorage.
