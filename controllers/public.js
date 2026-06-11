const { friendcircle: FriendCircleModel, video: VideoModel, videocomment: VideoCommentModel, article: ArticleModel, tag: TagModel,
    comment: CommentModel, reply: ReplyModel, user: UserModel, videoreply: VideoReplyModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { logger } = require('../middlewares/logger');


class PublicController {
    // 返回朋友圈信息
    static async getFriendCircle(req, res, next) {
        const { pageNum = 1, pageSize = 10, userId } = req.body;
            let findParam =  {
                where: {userId: 1}, // 限制博主
                include: [
                    {
                        model: ArticleModel,
                        as: 'article',
                        row: true,
                        attributes: { exclude: ['content'] },
                        include: [{ model: CommentModel, attributes: ['id'], include: [{ model: ReplyModel, attributes: ['id'] }] }]
                    },
                    {
                        model: VideoModel,
                        as: 'video',
                        row: true,
                        include: [{ model: VideoCommentModel, attributes: ['id'], include: [{ model: VideoReplyModel, attributes: ['id'] }] }]
                    },
                ],
                offset: (pageNum - 1) * pageSize,
                limit: parseInt(pageSize),
                order: [['createdAt', 'DESC']],
                row: true,
                distinct: true // count 计算
            };
            try {
                const data = await FriendCircleModel.findAndCountAll(findParam);
                data.pageSize = pageSize;
                data.pageNum = pageNum;
                packageResponse('success', { data }, res);
            } catch(err) {
                logger.info(`============请求朋友圈数据失败：${err}============`);
                packageResponse('error', {errorMessage: err}, res);
            }
    }

    // 返回tag列表
    static async getTagList(req, res, next) {
        let data = await TagModel.findAll({
            attributes: ['id', 'tagName']
        });
        packageResponse('success', { data }, res);
    }
} 

module.exports = PublicController;