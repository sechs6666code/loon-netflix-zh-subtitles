# 排行榜服务（可选自建版本）

线上站点已经连接托管的持久化排行榜与 PWA 提醒 API。本目录保留等价的 Cloudflare Worker + D1 实现，供迁移、自建或灾备使用。用户选择公开时，数据库只保存：

- 自定义公开 ID
- 连续忍住天数
- 连续冲的天数
- 当前浏览器身份令牌的 SHA-256 摘要

它不会保存每日打卡日期、完整日历或恢复仓数据。用户选择不公开时，会删除该浏览器此前上传的榜单资料；自定义 ID 和完整记录只留在本机。

用户主动开启每日提醒后，服务只额外保存匿名推送地址、浏览器加密公钥、提醒时间与时区。打卡状态不会上传，因此提醒每天固定发送，不会根据当天是否已经打卡而跳过。

部署步骤：

1. 在 Cloudflare 创建名为 `chonglema-leaderboard` 的 D1 数据库。
2. 把数据库 ID 填入 `wrangler.jsonc`。
3. 生成一对 VAPID 密钥，将公钥配置为 `VAPID_PUBLIC_KEY`，将 JWK 格式私钥配置为 Worker secret `VAPID_PRIVATE_KEY`。
4. 在项目根目录安装依赖，执行迁移并部署 Worker；`wrangler.jsonc` 已包含每 5 分钟一次的定时触发器。
5. 将 Worker 地址填入 `assets/leaderboard-config.js`。

```bash
npx @pushforge/builder vapid
npx wrangler secret put VAPID_PRIVATE_KEY --config leaderboard-worker/wrangler.jsonc
npx wrangler d1 migrations apply chonglema-leaderboard --remote --config leaderboard-worker/wrangler.jsonc
npx wrangler deploy --config leaderboard-worker/wrangler.jsonc
```

排行榜采用荣誉制。服务器会校验 ID 唯一性并保护同一 ID 的修改权，但不会上传完整打卡历史来核验连续天数。
