const { video: VideoModel, videocomment: VideoCommentModel, friendcircle: FriendCircleModel, user: UserModel, videoreply: VideoReplyModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { find } = require('../controllers/user');
const { logger } = require('../middlewares/logger');
const { findIsCollection } = require('../controllers/collection');
const { normalizePartition, getPartitionWhere } = require('../utils/partition');
const { appendContentListFilter, appendKeywordFilter } = require('../utils/contentListFilter');
const OSS = require('ali-oss');
const { ALIOSS } = require('../config');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const path = require("path");
const TaskScheduler = require('../utils/schedule');
const fs = require("fs");
ffmpeg.setFfmpegPath(ffmpegPath);

const UPLOADS_DIR = path.resolve("uploads");
const outputDir = path.join(__dirname, `../static/video`); // 切片输出地址
let scheduleTask = {};
const SCHEDULE_TIME = '30 1 1 * * *'; // 每天的1点1分30秒

// ffmpeg 是最吃 CPU/内存的步骤，这里把默认并发限制为 1，避免多个大视频同时切片把服务器内存打满。
const FFMPEG_MAX_CONCURRENT = Math.max(parseInt(process.env.FFMPEG_MAX_CONCURRENT || '1', 10), 1);
// 每个 ffmpeg 进程内部也限制线程数，默认单线程；如果服务器配置更高，可以通过环境变量 FFMPEG_THREADS 调大。
const FFMPEG_THREADS = Math.max(parseInt(process.env.FFMPEG_THREADS || '1', 10), 1);
// HLS 每个 ts 分片的目标时长，默认 3 秒；分片越短首屏和拖动越灵敏，但请求数量也会更多。
const HLS_SEGMENT_DURATION = Math.max(parseInt(process.env.HLS_SEGMENT_DURATION || '3', 10), 1);
// 播放端使用的多清晰度配置：低清晰度保证弱网能快速起播，高清晰度保留观感。
const VIDEO_RENDITIONS = [
    { name: '360p', height: 360, bandwidth: 1000000, videoBitrate: '800k', maxrate: '1000k', bufsize: '2000k', audioBitrate: '96k' },
    { name: '720p', height: 720, bandwidth: 3000000, videoBitrate: '2500k', maxrate: '3000k', bufsize: '6000k', audioBitrate: '128k' },
    { name: '1080p', height: 1080, bandwidth: 5500000, videoBitrate: '4500k', maxrate: '5500k', bufsize: '11000k', audioBitrate: '160k' },
];
// 记录当前正在运行的 ffmpeg 数量，配合队列实现“排队切片”。
let ffmpegActiveCount = 0;
// 等待执行的 ffmpeg 任务队列；超过并发限制的切片任务会先放在这里。
const ffmpegQueue = [];
// 记录视频后台处理状态；进程重启后内存状态会丢失，但可以通过 master.m3u8 是否存在兜底判断成功状态。
const videoProcessStatus = new Map();

// 统一生成本地 HLS 播放地址，避免不同接口拼出来的路径不一致。
function getLocalVideoUrl(fragmentName) {
    return `http://www.alanarmstrong.xyz/videoPath/${fragmentName}/master.m3u8`;
}

// 根据视频 key 生成本地 master.m3u8 路径；只要该文件存在，就说明多清晰度切片已经真正完成。
function getMasterPlaylistPath(fragmentName) {
    return path.resolve(path.join(outputDir, fragmentName, 'master.m3u8'));
}

// 从本地播放地址里反推出视频 key，createVideo 时用来判断切片是否已经完成。
function getFragmentNameFromVideoUrl(videoUrl = '') {
    const matched = String(videoUrl).match(/\/videoPath\/([^/]+)\/master\.m3u8/);
    return matched ? matched[1] : '';
}

// 统一写入后台处理状态，方便 mergeChunks、轮询接口和日志使用同一份状态结构。
function setVideoProcessStatus(fragmentName, status, extra = {}) {
    videoProcessStatus.set(fragmentName, {
        fileHash: fragmentName,
        status,
        videoUrl: getLocalVideoUrl(fragmentName),
        updatedAt: new Date().toISOString(),
        ...extra,
    });
}

// 读取后台处理状态；如果内存状态丢了，但 master.m3u8 已存在，也直接返回 success。
function getVideoProcessStatus(fragmentName) {
    if (!fragmentName) {
        return { status: 'unknown', message: '缺少 fileHash' };
    }
    if (fs.existsSync(getMasterPlaylistPath(fragmentName))) {
        return {
            fileHash: fragmentName,
            status: 'success',
            progress: 100,
            videoUrl: getLocalVideoUrl(fragmentName),
            message: '视频切片已完成',
        };
    }
    return videoProcessStatus.get(fragmentName) || {
        fileHash: fragmentName,
        status: 'unknown',
        progress: 0,
        videoUrl: getLocalVideoUrl(fragmentName),
        message: '未找到后台处理状态，可能需要重新触发合并/切片',
    };
}

// 写入 HLS 主播放列表，前端播放器加载 master.m3u8 后会根据网络自动选择 360p/720p/1080p。
function writeMasterPlaylist(folderPath, renditions) {
    const content = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        ...renditions.flatMap((item) => [
            `#EXT-X-STREAM-INF:BANDWIDTH=${item.bandwidth}`,
            `${item.name}/index.m3u8`,
        ]),
        '',
    ].join('\n');
    fs.writeFileSync(path.join(folderPath, 'master.m3u8'), content);
}

// 递归收集目录下所有文件，多清晰度 HLS 会产生子目录，定时上传 OSS 时需要递归处理。
function getFilesRecursive(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((result, item) => {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            result.push(...getFilesRecursive(fullPath));
        } else {
            result.push(fullPath);
        }
        return result;
    }, []);
}

// 读取源视频高度，用于决定是否需要生成 1080p；低分辨率视频不做无意义的放大转码。
function getVideoHeight(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                logger.info(`============读取视频元信息失败:${err}，将按默认多清晰度处理============`);
                return resolve(0);
            }
            const stream = (metadata.streams || []).find((item) => item.codec_type === 'video');
            resolve(stream && stream.height ? stream.height : 0);
        });
    });
}

// 控制 ffmpeg 并发：有空位就立即执行，没有空位就排队，前一个任务结束后自动唤醒下一个。
function runFfmpegWithLimit(taskName, taskFactory) {
    return new Promise((resolve, reject) => {
        const run = () => {
            ffmpegActiveCount += 1;
            logger.info(`============ffmpeg任务进入执行:${taskName},当前并发:${ffmpegActiveCount}/${FFMPEG_MAX_CONCURRENT},等待队列:${ffmpegQueue.length}============`);

            Promise.resolve()
                .then(taskFactory)
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    ffmpegActiveCount -= 1;
                    const next = ffmpegQueue.shift();
                    if (next) next();
                });
        };

        if (ffmpegActiveCount < FFMPEG_MAX_CONCURRENT) {
            run();
        } else {
            ffmpegQueue.push(run);
            logger.info(`============ffmpeg任务排队:${taskName},等待队列:${ffmpegQueue.length}============`);
        }
    });
}

// 使用流式追加合并分片，避免 readFileSync 一次把分片完整读进内存，降低大视频合并时的内存峰值。
function appendChunkToFile(chunkPath, filePath) {
    return new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(chunkPath);
        const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        readStream.pipe(writeStream);
    });
}

// 定时任务 处理本地视频文件到阿里云oss
const task = async function (fileName, folderPath) {
    const videoList = await VideoModel.findAll({ where: { id: { $not: -1 } } });
    let updatedList = [];
    for (let i = 0; i < videoList.length; i++) {
        const videoUrl = videoList[i].videoUrl;
        const id = videoList[i].id;
        if (videoUrl.includes(fileName) && videoUrl.includes('videoPath')) {
            logger.info(`============定时任务开始处理第${i + 1}项,视频id为${id},标题为${videoList[i].title}============`);
            try {
                let ossVideoUrl = await VideoControllers.uploadFragment(fileName);
                updatedList.push({ id, ossVideoUrl });
                logger.info(`============定时任务处理第${i + 1}项, 视频id为${id}, 标题为${videoList[i].title}成功============`);
            } catch (err) {
                logger.info(`============定时任务处理第${i + 1}项, 视频id为${id}, 标题为${videoList[i].title}失败,原因为${err}============`);
            }
        }
    }
    // 拿到需要更新的url更新；如果本轮没有匹配到视频记录，就只停止任务，避免空数组报错。
    if (updatedList.length > 0) {
        let id = updatedList[0].id;
        let ossVideoUrl = updatedList[0].ossVideoUrl;
        await VideoModel.update({ videoUrl: ossVideoUrl }, { where: { id } });
    }
    // uploadFragment 已经递归上传并清理本地目录，这里不再重复读取/删除文件夹。
    scheduleTask[fileName] && scheduleTask[fileName].stop();
    delete scheduleTask[fileName];
    logger.info(`============定时任务处理完成============`);
    return console.log('允许定时任务每天2点把本地视频文件上传到阿里云oss...' + new Date().getMinutes() + "-" + new Date().getSeconds());
};

const client = new OSS({
    region: ALIOSS.region,
    accessKeyId: ALIOSS.accessKeyId,
    accessKeySecret: ALIOSS.accessKeySecret,
    bucket: ALIOSS.bucket,
});

const schemaCreateVideo = joi.object({
    authorId: joi.number().required(),
    videoUrl: joi.string().required(),
    title: joi.string().required(),
    content: joi.string().required(),
    poster: joi.string().allow(null, ''),
    visibleType: joi.number(),
    partition: joi.string().allow(null, ''),
});
const schemaSearchVideo = joi.object({
    id: joi.number().required(),
    owner: joi.number().required(),
});
const schemaDeleteVideo = joi.object({
    videoId: joi.number().required(),
});
const schemaEditVideo = joi.object({
    videoId: joi.number().required(),
    authorId: joi.number().required(),
    videoUrl: joi.string().required(),
    title: joi.string().required(),
    content: joi.string().required(),
    poster: joi.string().allow(null, ''),
    visibleType: joi.number(),
    partition: joi.string().allow(null, ''),
});

class VideoControllers {
    // 创建视频
    static async createVideo(req, res, next) {
        const { error } = schemaCreateVideo.validate(req.body);

        if (!error) {
            const { title, content, authorId, visibleType, videoUrl, poster, partition } = req.body;
            const normalizedPartition = normalizePartition(partition);
            const fragmentName = getFragmentNameFromVideoUrl(videoUrl);
            if (fragmentName && !fs.existsSync(getMasterPlaylistPath(fragmentName))) {
                return packageResponse('error', { errorMessage: '视频仍在处理中，请等待切片完成后再发布' }, res);
            }
            const result = await VideoModel.findOne({ where: { videoUrl } });
            logger.info(`============用户ID:${authorId}上传视频============`);
            if (result) {
                logger.info(`============用户ID:${authorId}上传视频失败，视频已存在============`);
                packageResponse('error', { errorMessage: '创建失败，该视频已存在！' }, res);
            } else {
                try {
                    const authorData = await find({ id: authorId });

                    if (authorData) {
                        const data = await VideoModel.create(
                            { title, content, poster, visibleType, videoUrl, partition: normalizedPartition, author: authorData.username, userId: authorId },
                        )
                        // 记录到朋友圈
                        FriendCircleModel.create({ userId: authorId, videoId: data.id, type: 2 });
                        packageResponse('success', { data, successMessage: '上传视频成功' }, res);
                    } else {
                        packageResponse('error', { errorMessage: '上传视频失败: 未找到该作者' }, res);
                    }
                } catch (err) {
                    logger.info(`============用户ID:${authorId}上传视频失败:${err}`);
                    packageResponse('error', { errorMessage: '上传视频失败: ' + err }, res);
                }

            }
        } else {
            packageResponse('error', { errorMessage: '上传视频失败: ' + error }, res);
        }
    }

    // 获取视频列表
    static async getVideoList(req, res, next) {
        const {
            pageNum = 1,
            pageSize = 10,
            keyword = '',
            userId = '',
            partition,
            author: filterAuthor,
            title,
            visibleType,
            createdAtStart,
            createdAtEnd,
        } = req.body;
        // partition 是可选筛选项；只有前端明确传入时才按分区过滤。
        const partitionWhere = String(partition || '').trim() ? getPartitionWhere(partition) : {};
        let localIP = req?.socket?.remoteAddress || '';
        let videoOrder = [['createdAt', 'DESC']];
        let findParam = {};
        const commonFilter = { author: filterAuthor, title, visibleType, createdAtStart, createdAtEnd };
        logger.info(`============userId为:${userId},IP为${localIP}的用户开始请求视频列表============`);
        // 如果传值有userId，则查询对应的author
        if (userId) {
            const authorData = await find({ id: userId });
            if (!authorData) return;
            let author = authorData.username;
            const where = appendContentListFilter({ ...partitionWhere }, commonFilter, { fixedAuthor: author, allowPrivate: true });
            findParam = {
                where,
                include: [
                    {
                        model: VideoCommentModel,
                        attributes: ['id', 'content', 'createdAt'],
                        include: [{ model: VideoReplyModel, attributes: ['id'] }]
                    }
                ],
                offset: (pageNum - 1) * pageSize,
                limit: parseInt(pageSize),
                order: videoOrder,
                row: true,
                distinct: true // count 计算
            };
        } else {
            const where = appendKeywordFilter(
                appendContentListFilter({ id: { $not: -1 }, ...partitionWhere }, commonFilter, { allowPrivate: false }),
                keyword
            );
            findParam = {
                where,
                include: [
                    {
                        model: VideoCommentModel,
                        attributes: ['id', 'content', 'createdAt'],
                        include: [{ model: VideoReplyModel, attributes: ['id'] }]
                    }
                ],
                offset: (pageNum - 1) * pageSize,
                limit: parseInt(pageSize),
                order: videoOrder,
                row: true,
                distinct: true // count 计算
            };
        }

        try {
            const data = await VideoModel.findAndCountAll(findParam);
            data.rows.forEach(d => {
                // 旧视频没有分区时按默认分区返回，避免前端编辑和列表筛选拿到空值。
                d.setDataValue('partition', normalizePartition(d.partition));
            });
            data.pageSize = pageSize;
            data.pageNum = pageNum;
            packageResponse('success', { data }, res);
        } catch (err) {
            packageResponse('error', { errorMessage: err }, res);
        }

    }

    //   获取推荐视频列表
    static async getRecommendVideoList(req, res, next) {
        const { partition } = req.body;
        let videoOrder = [['recommend', 'DESC']];
        let findParam = {
            // 详情页热门视频按当前视频分区过滤；未传时按默认分区兜底。
            where: { visibleType: { $not: 3 }, ...getPartitionWhere(partition) },
            attributes: { exclude: ['content'] },
            limit: 6,
            order: videoOrder,
            row: true,
            distinct: true // count 计算
        };
        try {
            const data = await VideoModel.findAndCountAll(findParam);
            data.rows.forEach(d => {
                // 旧视频没有分区时，返回默认分区，避免侧边栏卡片混用空分区。
                d.setDataValue('partition', normalizePartition(d.partition));
            });
            packageResponse('success', { data }, res);
        } catch (err) {
            packageResponse('error', { errorMessage: err }, res);
        }

    }

    // 获取视频详情
    static async findVideoById(req, res, next) {
        const { error } = schemaSearchVideo.validate(req.body);
        let localIP = req?.socket?.remoteAddress || '';
        if (error) {
            packageResponse('error', { errorMessage: error }, res);
        } else {
            const { id, owner } = req.body;
            logger.info(`============用户ID:${owner},IP为${localIP}请求视频:${id}============`);
            const isCollected = await findIsCollection(owner, id, 2);
            const data = await VideoModel.findOne({
                where: { id },
                include: [
                    {
                        model: VideoCommentModel,
                        attributes: ['id', 'content', 'createdAt'],
                        include: [
                            {
                                model: VideoReplyModel,
                                attributes: ['id', 'content', 'createdAt'],
                                include: [{ model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } }],
                            },
                            { model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } },
                        ],
                        row: true,
                    },
                    { model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } },
                ],
                order: [[VideoCommentModel, 'createdAt', 'DESC'], [[VideoCommentModel, VideoReplyModel, 'createdAt', 'DESC']]], // comment model order
                row: true,
            });

            if (data) {
                // 更新点击数和热度
                VideoModel.update({ viewCount: ++data.viewCount, recommend: ++data.recommend }, { where: { id } });
                let _data = { ...data.dataValues, isCollected, partition: normalizePartition(data.partition) };
                packageResponse('success', { data: _data }, res);
            } else {
                packageResponse('error', { errorMessage: '该视频已不存在！' }, res);
            }
        }
    }

    // 修改视频
    static async editVideo(req, res, next) {
        const { error } = schemaEditVideo.validate(req.body);
        if (!error) {
            const { videoId, title, content, visibleType, authorId, poster, videoUrl, partition } = req.body;
            try {
                // const tags = tagList || [];
                const updateData = { title, content, visibleType, poster, videoUrl };
                if (Object.prototype.hasOwnProperty.call(req.body, 'partition')) {
                    updateData.partition = normalizePartition(partition);
                }
                await VideoModel.update(updateData, { where: { id: videoId } });

                //  如果设置了加锁，则更新密码
                // if (visibleType === 2) {
                //     await ArticleControllers.updateArticleLock(articleId, authorId, password);
                // }
                logger.info(`============用户ID:${authorId}修改视频:${videoId}============`);
                packageResponse('success', { successMessage: '修改视频成功' }, res);
            } catch (err) {
                logger.info(`============用户ID:${authorId}修改视频失败:${err}`);
                packageResponse('error', { errorMessage: '修改视频失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '修改视频失败: ' + error }, res);
        }
    }

    // 删除视频
    static async deleteVideo(req, res, next) {
        const { error } = schemaDeleteVideo.validate(req.body);
        if (!error) {
            const { videoId } = req.body;
            try {
                await sequelize.query(
                    `delete videocomment, videoreply, video
                    from video
                    left join videoreply on video.id=videoreply.videoId
                    left join videocomment on video.id=videocomment.videoId
                    where video.id=${videoId}`
                );
                await FriendCircleModel.destroy({ where: { videoId } });
                logger.info(`============用户删除视频:${videoId}============`);
                packageResponse('success', { successMessage: '删除视频成功' }, res);
            } catch (err) {
                logger.info(`============用户删除视频:${videoId}失败:${err}============`);
                packageResponse('error', { errorMessage: '删除视频失败: ' + err }, res);
            }
        } else {
            logger.info(`============用户删除视频:失败:${error}============`);
            packageResponse('error', { errorMessage: '删除视频失败: ' + error }, res);
        }
    }

    // 上传大视频(不用)
    static async uploadBigVideo(req, res, next) {
        if (req.file) {
            try {
                let filePath = path.join(__dirname, `../uploads/${req.file.filename}`); // 视频地址
                let outputDir = path.join(__dirname, `../static/video`); // 切片输出地址
                // 这里也走统一的 ffmpeg 排队逻辑，避免“大视频直传”和“分片上传”同时切片抢资源。
                const fragmentName = req.file.filename;
                const videoUrl = getLocalVideoUrl(fragmentName);
                setVideoProcessStatus(fragmentName, 'processing', { progress: 1, message: '文件上传完成，等待后台转码切片' });
                VideoControllers.videoFragment({ filePath, outputDir, fileName: req.file.filename })
                    .then((url) => logger.info(`============${req.file.filename}后台切片完成,url是:${url}============`))
                    .catch((err) => logger.info(`============${req.file.filename}后台切片失败:${err && err.err ? err.err : err}============`));
                logger.info(`============${req.file.filename}视频上传完成，后台开始切片============`);
                packageResponse('success', { data: { ...req.file, videoUrl, fileHash: fragmentName, processStatus: 'processing' } }, res);
            } catch (err) {
                logger.info(`============${req.file.filename}视频上传失败:${err}============`);
                packageResponse('error', { errorMessage: '上传视频失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '上传视频失败' }, res);
        }
    }

    // 分片上传
    static async uploadChunks(req, res, next) {
        const { fileHash, chunkHash } = req.body;
        try {
            // 如果临时文件夹(用于保存分片)不存在，则创建
            const chunkDir = path.resolve(UPLOADS_DIR, fileHash);
            if (!fs.existsSync(chunkDir)) {
                fs.mkdirSync(chunkDir);
            }

            // 如果临时文件夹里不存在该分片，则将用户上传的分片移到临时文件夹里
            const chunkPath = path.resolve(chunkDir, chunkHash);
            if (!fs.existsSync(chunkPath)) {
                fs.renameSync(req.files.chunk.path, chunkPath);
            }
            logger.info(`============${chunkHash}视频分片上传成功============`);
            packageResponse('success', { successMessage: '上传成功' }, res);
        } catch (error) {
            logger.info(`============${chunkHash}视频分片上传失败============`);
            packageResponse('error', { errorMessage: '上传失败' }, res);
        }
    }

    // 分片合并
    static async mergeChunks(req, res, next) {
        const { fileHash, fileName, userId } = req.body;
        // 最终合并的文件路径
        const filePath = path.resolve(UPLOADS_DIR, fileHash + path.extname(fileName));
        // 临时文件夹路径
        const chunkDir = path.resolve(UPLOADS_DIR, fileHash);

        // 读取临时文件夹，获取该文件夹下“所有文件（分片）名称”的数组对象
        const chunkPaths = fs.readdirSync(chunkDir);

        // 读取临时文件夹获得的文件（分片）名称数组可能乱序，需要重新排序
        chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);

        try {
            // 遍历文件（分片）数组，将分片追加到文件中
            for (const chunkName of chunkPaths) {
                const chunkPath = path.resolve(chunkDir, chunkName);
                // 将分片追加到文件中；这里使用流式写入，避免大分片一次性进入内存。
                await appendChunkToFile(chunkPath, filePath);
                // 删除分片；只有当前分片成功写入后才删除，避免合并失败时误删未写入的数据。
                fs.unlinkSync(chunkPath);
            }
            // 等待所有分片追加到文件后，删除临时文件夹
            fs.rmdirSync(chunkDir);
            logger.info(`============分片追加完毕,删除临时文件夹${chunkDir}============`);
            console.log(filePath)
            const videoUrl = getLocalVideoUrl(fileHash);
            // 合并完成后立即进入后台切片，不再让 HTTP 请求一直等待 ffmpeg，避免大视频导致接口超时。
            setVideoProcessStatus(fileHash, 'processing', { progress: 1, message: '分片合并完成，等待后台转码切片' });
            VideoControllers.videoFragment({ filePath, outputDir, fileName: fileName, fileHash, userId })
                .then((url) => {
                    logger.info(`============视频${fileHash}后台切片完成,url是:${url}============`);
                })
                .catch((err) => {
                    logger.info(`============视频${fileHash}后台切片失败:${err && err.err ? err.err : err}============`);
                });
            console.log('url是==========' + videoUrl);

            packageResponse('success', {
                successMessage: '文件合并成功，视频正在后台转码切片',
                data: { videoUrl, fileHash, processStatus: 'processing' }
            }, res);
        } catch (error) {
            console.log(error);
            packageResponse('error', { errorMessage: '文件上传失败！' }, res);
        }
    }

    // 查询视频转码/切片状态，前端在 mergeChunks 返回 processing 后轮询这个接口。
    static async getVideoProcessStatus(req, res, next) {
        const { fileHash, videoUrl } = req.body;
        const fragmentName = fileHash || getFragmentNameFromVideoUrl(videoUrl);
        packageResponse('success', { data: getVideoProcessStatus(fragmentName) }, res);
    }

    // 校验分片是否存在
    static async verify(req, res, next) {
        const { fileHash, fileName } = req.body;
        // 判断服务器上是否存在该hash值的文件
        const filePath = path.resolve(UPLOADS_DIR, fileHash + path.extname(fileName));
        const existFile = fs.existsSync(filePath);

        // 获取已经上传到服务器的文件分片
        const chunkDir = path.resolve(UPLOADS_DIR, fileHash);
        const existChunks = [];
        if (fs.existsSync(chunkDir)) {
            existChunks.push(...fs.readdirSync(chunkDir));
        }
        if (existFile) {
            logger.info(`============${chunkDir}视频已存在============`);
            // 分片合并后的切片目录使用 fileHash 命名，所以秒传/重试时也返回 hash 版本的本地播放地址。
            const processInfo = getVideoProcessStatus(fileHash);
            packageResponse('success', {
                successMessage: '文件已存在',
                data: { existFile, existChunks, videoUrl: getLocalVideoUrl(fileHash), processStatus: processInfo.status, processInfo }
            }, res);
        } else {
            logger.info(`============${chunkDir}视频不存在============`);
            packageResponse('success', { successMessage: '文件不存在', data: { existFile, existChunks } }, res);
        }
    }

    /**
        * 视频分片：mp4 转为 m3u8 和 ts格式
    * @param {*} options
    * @param filePath： 文件路径
    * @param outputDir: 生成文件存放地址
    * @param fileName：文件名
    * @param duration: 视频分片间隔
    * @param userId: 上传用户的ID
    * @returns
     */
    static videoFragment(options = {}) {
        const { filePath, outputDir, fileHash, fileName, duration = HLS_SEGMENT_DURATION, userId } = options;
        // fileHash 优先用于目录名，避免中文文件名、括号等特殊字符在 Linux/nginx/ffmpeg 中产生路径兼容问题。
        const fragmentName = fileHash || fileName;
        const taskName = fileName || fragmentName;

        return runFfmpegWithLimit(taskName, async () => {
            const inputPath = path.resolve(path.join(filePath));
            const folderPath = path.resolve(path.join(outputDir, fragmentName));
            const videoUrl = getLocalVideoUrl(fragmentName);

            // 切片前先确认合并后的源文件存在，避免 ffmpeg 启动后才报一个难读的路径错误。
            if (!fs.existsSync(inputPath)) {
                const err = new Error(`源视频文件不存在:${inputPath}`);
                setVideoProcessStatus(fragmentName, 'failed', { progress: 0, message: err.message });
                throw err;
            }

            // 确保目录存在
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
                logger.info(`============创建${folderPath}文件夹成功============`);
            } else {
                console.log(`${folderPath}已存在`);
            }

            const timeStart = new Date().getTime();
            const masterItems = [];
            const sourceHeight = await getVideoHeight(inputPath);
            // 根据源视频高度筛选输出档位，避免 720p 源视频再生成 1080p 这种浪费空间和时间的结果。
            let renditions = sourceHeight ? VIDEO_RENDITIONS.filter((item) => item.height <= sourceHeight) : VIDEO_RENDITIONS;
            if (renditions.length === 0) {
                // 极小分辨率视频至少生成一档 360p，保证前端始终能拿到可播放的 master.m3u8。
                renditions = [VIDEO_RENDITIONS[0]];
            }
            setVideoProcessStatus(fragmentName, 'processing', { progress: 5, message: '开始生成多清晰度播放文件', sourceHeight });

            try {
                for (let i = 0; i < renditions.length; i++) {
                    const rendition = renditions[i];
                    const baseProgress = Math.round((i / renditions.length) * 90) + 5;
                    const nextProgress = Math.round(((i + 1) / renditions.length) * 90) + 5;
                    setVideoProcessStatus(fragmentName, 'processing', {
                        progress: baseProgress,
                        currentQuality: rendition.name,
                        message: `正在生成${rendition.name}播放文件`,
                    });

                    const result = await VideoControllers.transcodeHlsRendition({
                        inputPath,
                        folderPath,
                        fragmentName,
                        rendition,
                        duration,
                    });
                    masterItems.push(result);
                    setVideoProcessStatus(fragmentName, 'processing', {
                        progress: nextProgress,
                        currentQuality: rendition.name,
                        message: `${rendition.name}播放文件生成完成`,
                    });
                }

                writeMasterPlaylist(folderPath, masterItems);
                const timeEnd = new Date().getTime();
                let time1 = (timeEnd - timeStart) / 1000;
                logger.info(`============视频${fragmentName}多清晰度切片成功,共耗时${time1}秒============`);
                setVideoProcessStatus(fragmentName, 'success', { progress: 100, message: '视频转码切片完成' });

                if (!scheduleTask[fragmentName]) {
                    scheduleTask[fragmentName] = new TaskScheduler(SCHEDULE_TIME, () => task(fragmentName, folderPath, userId));
                    scheduleTask[fragmentName].start();
                    logger.info(`============启动定时任务============`);
                }

                return videoUrl;
            } catch (err) {
                const errorMessage = err && err.err
                    ? (err.err.message || String(err.err))
                    : (err && err.message ? err.message : String(err));
                setVideoProcessStatus(fragmentName, 'failed', {
                    progress: 0,
                    message: '视频转码切片失败',
                    errorMessage,
                });
                throw err;
            }
        });
    }

    // 生成单个清晰度的 HLS 播放列表和 ts 分片；外层已经限制并发，这里每个清晰度按顺序执行。
    static transcodeHlsRendition(options = {}) {
        const { inputPath, folderPath, fragmentName, rendition, duration } = options;
        return new Promise((resolve, reject) => {
            const renditionDir = path.join(folderPath, rendition.name);
            const segmentPath = path.join(renditionDir, `${rendition.name}_%05d.ts`);
            const m3u8Path = path.join(renditionDir, 'index.m3u8');
            let timeStart = '';
            let lastProgressLogTime = 0;

            // 每个清晰度独立目录，方便播放器按相对路径加载，也方便之后递归上传到 OSS。
            if (!fs.existsSync(renditionDir)) {
                fs.mkdirSync(renditionDir, { recursive: true });
            }

            ffmpeg()
                .input(inputPath)
                .format('hls')
                .outputOptions(
                    "-y", // 允许重试时覆盖同名清晰度文件。
                    "-threads", String(FFMPEG_THREADS), // 限制单个 ffmpeg 进程线程数，降低 CPU/内存瞬时占用。
                    "-c:v", "libx264", // 生成网页播放版视频，主动降低码率，解决每个 ts 几十 MB 的问题。
                    "-preset", "veryfast", // 在画质和转码速度之间取一个偏快的平衡，避免服务器长期满载。
                    "-crf", "24", // CRF 越大体积越小；24 对博客视频通常比较省流量。
                    "-b:v", rendition.videoBitrate,
                    "-maxrate", rendition.maxrate, // 限制峰值码率，避免某些复杂画面产生超大 ts。
                    "-bufsize", rendition.bufsize,
                    "-vf", `scale=-2:${rendition.height}`, // 按目标高度缩放，宽度自动取偶数，保证 H.264 兼容。
                    "-profile:v", "main",
                    "-pix_fmt", "yuv420p", // 兼容大多数浏览器和移动设备。
                    "-c:a", "aac",
                    "-b:a", rendition.audioBitrate,
                    "-ac", "2",
                    "-sn", // 不处理字幕流，减少不必要的流映射和内存占用。
                    "-hls_list_size", "0",
                    "-hls_playlist_type", "vod",
                    "-hls_time", String(duration),
                    "-force_key_frames", `expr:gte(t,n_forced*${duration})`, // 强制关键帧对齐切片边界，减少播放器拖动卡顿。
                    "-sc_threshold", "0",
                    "-start_number", "0",
                    "-max_muxing_queue_size", "512",
                    "-hls_segment_filename", segmentPath,
                )
                .output(m3u8Path)
                .on("start", (commandLine) => {
                    timeStart = new Date().getTime();
                    logger.info(`============视频${fragmentName}-${rendition.name}开始转码切片,ffmpeg命令:${commandLine}============`);
                })
                // 监听切片进度
                .on("progress", (data) => {
                    const now = Date.now();
                    // 进度日志做节流，最多约 10 秒打一条，避免大视频刷爆日志文件。
                    if (now - lastProgressLogTime > 10000) {
                        lastProgressLogTime = now;
                        logger.info(`============视频${fragmentName}-${rendition.name}切片中,进度:${data.percent || 0}%,时间点:${data.timemark || ''}============`);
                    }
                })
                .on("error", (err, stdout, stderr) => {
                    // SIGKILL/内存不足/格式不兼容等问题通常会进入这里；把 stderr 记录下来，后续排查比单看 err 更有信息量。
                    logger.info(`============视频${fragmentName}-${rendition.name}切片失败:${err},stderr:${stderr || ''}============`);
                    reject({
                        fileHash: fragmentName,
                        rendition: rendition.name,
                        err,
                        stderr,
                    });
                })
                .on("end", async () => {
                    const timeEnd = new Date().getTime();
                    let time1 = (timeEnd - timeStart) / 1000;
                    logger.info(`============视频${fragmentName}-${rendition.name}切片成功,共耗时${time1}秒============`);
                    resolve({
                        name: rendition.name,
                        bandwidth: rendition.bandwidth,
                    });
                })
                .run();
        });
    }

    // 上传切片至阿里云OSS
    static async uploadFragment(fileName, cb, failcb) {
        const _timeStart = new Date().getTime();
        const folderPath = path.resolve(path.join(__dirname, `../static/video/${fileName}`));
        const files = getFilesRecursive(folderPath);
        let videoUrl = '';
        logger.info(`============开始上传${fileName}视频文件至阿里云============`);
        for (let i = 0; i < files.length; i++) {
            const filePath = files[i];
            // 多清晰度 HLS 会有 360p/720p/1080p 子目录，OSS 路径需要保留相对目录结构。
            const relativePath = path.relative(folderPath, filePath).split(path.sep).join('/');
            const ossPath = `videos/${fileName}/${relativePath}`;
            const result = await VideoControllers.uploadToOSS(ossPath, filePath);
            logger.info(`============视频${filePath}上传阿里云OSS成功============`);
            // 如果上传成功，则删除本地文件
            if (result) {
                relativePath === 'master.m3u8' && (videoUrl = result);
                logger.info(`============删除本地文件夹${filePath}成功============`);
                fs.unlinkSync(filePath);
            }
        }
        // 所有文件上传后清理空目录，避免多清晰度子目录长期堆积。
        fs.rmSync(folderPath, { recursive: true, force: true });
        const _timeEnd = new Date().getTime();
        let time2 = (_timeEnd - _timeStart) / 1000;
        logger.info(`============${fileName}视频上传阿里云成功,共耗时${time2}秒,url是:${videoUrl}============`);
        return videoUrl;
    }

    /**
    將数据上传到阿里云OSS
    * @param ossPath oss目标文件路径
    * @param fileName: 本地文件存放地址
    * @returns
     */
    static async uploadToOSS(ossPath, fileName) {
        try {
            // 填写OSS文件完整路径和本地文件的完整路径。OSS文件完整路径中不能包含Bucket名称。
            // 如果本地文件的完整路径中未指定本地路径，则默认从示例程序所属项目对应本地路径中上传文件。
            const result = await client.put(ossPath, fileName)
            if (result.res.statusCode === 200) {
                return result.url;
            } else {
                return result;
            }
        } catch (e) {
            return e;
        }
    }


    /**
     * 删除阿里云oss文件
     * @param url 文件在阿里云OSS中的路径，不带bucket
     * @returns {Promise<boolean>}
     */
    static async deleteOSS(url) {
        try {
            await client.delete(url)
            return true
        } catch (error) {
            if (error.code === 'NoSuchKey') {
                return false
            }
        }
    }
}

module.exports = VideoControllers;
