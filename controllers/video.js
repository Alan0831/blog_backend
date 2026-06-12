const { video: VideoModel, videocomment: VideoCommentModel, friendcircle: FriendCircleModel, user: UserModel, videoreply: VideoReplyModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { find } = require('../controllers/user');
const { logger } = require('../middlewares/logger');
const { findIsCollection } = require('../controllers/collection');
const { normalizePartition, getPartitionWhere } = require('../utils/partition');
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
    // 拿到需要更新的url更新
    let id = updatedList[0].id;
    let ossVideoUrl = updatedList[0].ossVideoUrl;
    // 完成所有文件的上传，然后删除该文件夹
    const filesAfterUpload = fs.readdirSync(folderPath);
    if (filesAfterUpload.length === 0) {
        fs.rmdirSync(folderPath, { recursive: true });
    }
    await VideoModel.update({ videoUrl: ossVideoUrl }, { where: { id } });
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
        const { pageNum = 1, pageSize = 10, keyword = '', userId = '', partition } = req.body;
        const partitionWhere = getPartitionWhere(partition);
        let localIP = req?.socket?.remoteAddress || '';
        let videoOrder = [['createdAt', 'DESC']];
        let findParam = {};
        logger.info(`============userId为:${userId},IP为${localIP}的用户开始请求视频列表============`);
        // 如果传值有userId，则查询对应的author
        if (userId) {
            const authorData = await find({ id: userId });
            if (!authorData) return;
            let author = authorData.username;
            findParam = {
                where: {
                    author,
                    ...partitionWhere,
                },
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
            findParam = {
                where: {
                    id: { $not: -1 },   // 过滤关于页面的副本
                    visibleType: { $not: 3 },
                    ...partitionWhere,
                    $or: {
                        title: {
                            $like: `%${keyword}%`
                        },
                        content: {
                            $like: `%${keyword}%`
                        },
                    },
                },
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
            where: { visibleType: { $not: 3 }, ...getPartitionWhere(partition) },
            attributes: { exclude: ['content'] },
            limit: 6,
            order: videoOrder,
            row: true,
            distinct: true // count 计算
        };
        try {
            const data = await VideoModel.findAndCountAll(findParam);
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
            let filePath = path.join(__dirname, `../uploads/${req.file.filename}`); // 视频地址
            let outputDir = path.join(__dirname, `../static/video`); // 切片输出地址
            let videoUrl = await VideoControllers.videoFragment({ filePath, outputDir, fileName: req.file.filename });
            logger.info(`============${req.file.filename}视频上传成功============`);
            packageResponse('success', { data: { ...req.file, videoUrl } }, res);
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

        // 遍历文件（分片）数组，将分片追加到文件中
        const pool = chunkPaths.map(
            (chunkName) =>
                new Promise((resolve) => {
                    const chunkPath = path.resolve(chunkDir, chunkName);
                    // 将分片追加到文件中
                    fs.appendFileSync(filePath, fs.readFileSync(chunkPath));
                    // 删除分片
                    fs.unlinkSync(chunkPath);
                    resolve();
                })
        );
        try {
            await Promise.all(pool);
            // 等待所有分片追加到文件后，删除临时文件夹
            fs.rmdirSync(chunkDir);
            logger.info(`============分片追加完毕,删除临时文件夹${chunkDir}============`);
            console.log(filePath)
            let videoUrl = await VideoControllers.videoFragment({ filePath, outputDir, fileName: fileName, userId });
            console.log('url是==========' + videoUrl);

            packageResponse('success', { successMessage: '文件上传成功', data: { videoUrl} }, res);
        } catch (error) {
            console.log(error);
            packageResponse('error', { errorMessage: '文件上传失败！' }, res);
        }
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
            packageResponse('success', { successMessage: '文件已存在', data: { existFile, existChunks, videoUrl: `http://commit-alan.oss-cn-beijing.aliyuncs.com/videos/${fileName}/${fileName}.m3u8` } }, res);
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
        const { filePath, outputDir, fileName, duration = 5, userId } = options;
        return new Promise((resolve, reject) => {
            const folderPath = path.resolve(path.join(outputDir, fileName));
            // 确保目录存在
            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
                logger.info(`============创建${folderPath}文件夹成功============`);
            } else {
                console.log(`${folderPath}已存在`);
            }
            let timeStart = '';
            let timeEnd = '';

            ffmpeg()
                .input(path.resolve(path.join(filePath)))
                // .videoCodec('libx264') // 设置视频编解码器
                // .audioCodec('libfaac') // 设置 音频解码器
                // .format('hls') // 输出视频格式
                // .outputOptions('-hls_list_size 0') //  -hls_list_size n:设置播放列表保存的最多条目，设置为0会保存有所片信息，默认值为5
                // .outputOption('-hls_time 5') // -hls_time n: 设置每片的长度，默认值为2。单位为秒
                .outputOptions([
                    "-hls_list_size 0",
                    "-start_number 0",
                    "-movflags +faststart",    // 启用faststart以提供更好的流体体验
                    `-hls_time ${duration}`,
                    "-hls_segment_filename",
                ])
                .output(`${path.join(outputDir)}/${fileName}/${fileName}_%02d.ts`)
                .output(`${path.join(outputDir)}/${fileName}/${fileName}.m3u8`)
                .on("start", () => {
                    console.log('开发切片 ===>>>', fileName);
                    // 准备完成直接回调 用来快速反应前端
                    resolve(`http://www.alanarmstrong.xyz/videoPath/${fileName}/${fileName}.m3u8`);
                    timeStart = new Date().getTime();
                    logger.info(`============视频${fileName}开始切片============`);
                })
                // 监听切片进度
                .on("progress", (data) => {

                })
                .on("error", (err) => {
                    logger.info(`============视频${fileName}切片失败:${err}============`);
                    reject({
                        fileName,
                        err,
                    });
                })
                .on("end", async () => {
                    console.log(`切片结束 ===>>>`, fileName);
                    timeEnd = new Date().getTime();
                    let time1 = (timeEnd - timeStart) / 1000;
                    logger.info(`============视频${fileName}切片成功,共耗时${time1}秒============`);
                    if (!scheduleTask[fileName]) {
                        scheduleTask[fileName] = new TaskScheduler(SCHEDULE_TIME, () => task(fileName, folderPath, userId));
                        scheduleTask[fileName].start();
                        logger.info(`============启动定时任务============`);
                    }
                })
                .run();
        });
    }

    // 上传切片至阿里云OSS
    static async uploadFragment(fileName, cb, failcb) {
        const _timeStart = new Date().getTime();
        const folderPath = path.resolve(path.join(__dirname, `../static/video/${fileName}`));
        const files = fs.readdirSync(folderPath);
        let videoUrl = '';
        logger.info(`============开始上传${fileName}视频文件至阿里云============`);
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const filePath = path.join(folderPath, file);
            const ossPath = `videos/${fileName}/${file}`;
            const result = await VideoControllers.uploadToOSS(ossPath, filePath);
            logger.info(`============视频${filePath}上传阿里云OSS成功============`);
            // 如果上传成功，则删除本地文件
            if (result) {
                result.includes('m3u8') && (videoUrl = result);
                logger.info(`============删除本地文件夹${filePath}成功============`);
                fs.unlinkSync(filePath);
            }
        }
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
