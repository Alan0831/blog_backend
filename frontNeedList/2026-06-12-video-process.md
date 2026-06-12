# 视频上传后台转码前端配合事项

## 背景

后端 `/mergeChunks` 已改为“合并分片后立即返回，后台排队转码/切片”。这样可以避免大视频切片时 HTTP 请求等待几分钟甚至超时。

## 上传流程调整

1. 调用 `/mergeChunks` 后，不要立即调用 `/createVideo`。
2. `/mergeChunks` 成功返回示例：

```json
{
  "data": {
    "videoUrl": "http://www.alanarmstrong.xyz/videoPath/a319b2e5ea0db376284d0fbb6dc87b2d/master.m3u8",
    "fileHash": "a319b2e5ea0db376284d0fbb6dc87b2d",
    "processStatus": "processing"
  }
}
```

3. 前端拿到 `fileHash` 后轮询 `/getVideoProcessStatus`。

```json
{
  "fileHash": "a319b2e5ea0db376284d0fbb6dc87b2d"
}
```

4. 状态为 `success` 后再允许用户发布视频，并把返回的 `videoUrl` 提交给 `/createVideo`。

```json
{
  "data": {
    "fileHash": "a319b2e5ea0db376284d0fbb6dc87b2d",
    "status": "success",
    "progress": 100,
    "videoUrl": "http://www.alanarmstrong.xyz/videoPath/a319b2e5ea0db376284d0fbb6dc87b2d/master.m3u8",
    "message": "视频切片已完成"
  }
}
```

## 页面交互建议

1. `processing` 时显示“视频处理中”，禁用发布按钮。
2. 轮询间隔建议 3-5 秒。
3. `failed` 时显示失败原因，并提供重新上传或重新合并入口。
4. 播放器地址改用 `master.m3u8`，播放器如果支持 HLS master playlist，会自动按网络选择 360p/720p/1080p。

## 注意

后端会按源视频高度自动减少无效清晰度。例如源视频只有 720p 时，不会额外生成 1080p。
