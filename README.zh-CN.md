# aofahub-chat

基于 [DeepSeek chat-demo](https://github.com/deepseek-ai/chat-demo) 的 AofaHub 聊天页。

`https://chat.aofahub.dev` 是静态 Worker，不放密钥、不签发 Key。用管理员发放的用户名密码登录，网关写 HttpOnly `chat_session`。补全请求打 `https://aofahub.dev/anthropic/v1/skill/messages`。

`pnpm dev` 开 http://localhost:8090，接口默认代理到 `https://aofahub.dev`（本地网关用 `API_ORIGIN` 覆盖）。部署：`pnpm build && pnpm deploy`。
