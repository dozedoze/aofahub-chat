// Worker 入口：让项目不再是纯静态资源，这样才能在 Dashboard 里配置 Variables and Secrets。
// 目前只把请求转给静态资源；需要用密钥时，在这里通过 env 读取（如 env.MY_SECRET）。

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  // 在 Dashboard 或 `wrangler secret put <NAME>` 添加密钥后，在此声明类型，例如：
  // MY_SECRET: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request)
  },
}
