# Loon Netflix 中文字幕翻译插件

这个仓库提供一个 Loon 插件，用于在 iOS/iPadOS Netflix App 播放时拦截可用字幕响应，并把字幕内容实时翻译为中文。

## 能做什么

- 支持 WebVTT 和 TTML/IMSC 字幕响应。
- 支持免 Key 的 `google_web` 测试模式，也支持 DeepL Free、DeepL Pro、Google Cloud Translation Basic v2。
- 保留字幕时间轴、cue 设置和常见文本标签。
- 用 Loon `$persistentStore` 按单句缓存译文，减少重复调用。

## 不能做什么

- 不绕过 Netflix DRM。
- 不从视频或音频生成字幕。
- 不保证改写 Netflix App 的字幕菜单名称。
- 如果影片完全没有任何字幕轨，Loon 脚本通常没有字幕响应可处理，只能保持播放不变。
- 如果 Netflix iOS App 对相关域名启用证书固定导致 MitM 拿不到响应体，本插件无法工作。

## 安装

发布到 GitHub 后，用这个地址导入 Loon：

```text
https://raw.githubusercontent.com/sechs6666code/loon-netflix-zh-subtitles/main/netflix-zh-subtitles.plugin
```

在 Loon 插件参数里配置：

- `provider`: `google_web`、`deepl_free`、`deepl_pro` 或 `google_v2`
- `apiKey`: `google_web` 留空；其他服务填写对应 API Key
- `targetVariant`: `zh-Hans` 或 `zh-Hant`
- `debug`: 调试时开启，正常使用建议关闭

## Loon 设置

1. 在 Loon 中安装并信任 MitM 证书。
2. 打开 Loon 的 MitM 和 Script 功能。
3. 导入插件并填写 API Key。
4. 播放 Netflix 影片，选择任意可用字幕轨。
5. 如果没有出现中文字幕，先把 `debug` 打开，再查看 Loon 日志里是否捕获到字幕响应。

## 翻译服务

免 API Key：

- `google_web` 使用 Google Translate 网页接口，不需要 API Key。
- 这个接口不是正式 Cloud Translation API，可能被限流、地区拦截或突然失效；适合先验证字幕链路是否可用。

DeepL：

- `deepl_free` endpoint: `https://api-free.deepl.com/v2/translate`
- `deepl_pro` endpoint: `https://api.deepl.com/v2/translate`
- 简体中文目标码：`ZH-HANS`
- 繁体中文目标码：`ZH-HANT`

Google Cloud Translation Basic v2：

- endpoint: `https://translation.googleapis.com/language/translate/v2`
- 简体中文目标码：`zh-CN`
- 繁体中文目标码：`zh-TW`

## 本地测试

```powershell
npm test
```

测试覆盖：

- WebVTT 翻译和时间轴保留
- TTML/IMSC 翻译和 XML 标签保留
- 已有中文字幕跳过
- 翻译失败回退原字幕
- 缓存命中
- DeepL/Google 请求体映射
- google_web 免 Key 请求映射
- 字幕清单无轨提示检测

## 发布步骤

```powershell
git init -b main
git add .
git commit -m "Initial Loon Netflix subtitle translator"
git remote add origin https://github.com/sechs6666code/loon-netflix-zh-subtitles.git
git push -u origin main
```

推送前确认 `netflix-zh-subtitles.plugin` 中的 raw URL 指向你的真实 GitHub owner。

## 故障排查

- 插件无法导入：确认 raw URL 可直接打开，且文件名是 `netflix-zh-subtitles.plugin`。
- 没有字幕变化：确认 Netflix 里已经选择了一个可用字幕轨。
- 没有脚本日志：确认 `[MITM]` 里包含 `*.netflix.com, *.nflxvideo.net`，并且 Loon 的 MitM/Script 开关已开启。
- API 报错：确认 provider 与 API Key 类型匹配，例如 DeepL Free Key 必须使用 `deepl_free`；如果没有 Key，先用 `google_web`。
- 播放中断或字幕消失：关闭插件后重试；本脚本翻译失败时应回退原字幕，不应阻断播放。

## 隐私

脚本只把字幕 cue 文本发送给配置的翻译服务，不发送 Netflix token、完整播放 URL、账号信息或整份字幕文件。缓存键只包含 provider、目标语言和原文 SHA-1。
