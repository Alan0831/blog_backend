# 视频切片资源控制前端配合事项

## 背景

后端已把视频切片改为更省 CPU 的策略：

1. H.264/AAC 且分辨率不超过配置上限的视频，会直接封装成 HLS，不再重编码。
2. 不兼容的视频才会转码，默认只生成一档播放文件，最高 720p。
3. 多清晰度输出需要后端显式开启 `FFMPEG_ENABLE_MULTI_RENDITION=true`。

## 前端需要注意

1. 继续以 `/getVideoProcessStatus` 的 `status` 为准，不要假设切片会马上完成。
2. 新增可能状态：`queued`，表示任务正在排队，返回值里可能带有 `queuePosition`。
3. `master.m3u8` 里可能只有一档播放源，前端不要固定展示 360p/720p/1080p 清晰度按钮。
4. 如果播放器有清晰度选择 UI，请从 HLS 播放器实际解析到的 levels/renditions 动态生成；只有一档时隐藏清晰度选择。
5. 状态接口可能返回 `transcodeMode: "copy"` 或 `"transcode"`，这个字段仅用于展示/调试，不要依赖它判断是否可发布；发布仍以 `status === "success"` 为准。

