const { friendcircle: FriendCircleModel, video: VideoModel, videocomment: VideoCommentModel, article: ArticleModel, code: CodeModel, tag: TagModel,
    comment: CommentModel, reply: ReplyModel, user: UserModel, videoreply: VideoReplyModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { logger } = require('../middlewares/logger');
const { getPartitionWhere } = require('../utils/partition');

function parseTagList(tagList) {
    if (Array.isArray(tagList)) return tagList;
    if (!tagList) return [];
    try {
        const parsed = JSON.parse(tagList);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

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
        if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'partition')) {
            let data = await TagModel.findAll({
                attributes: ['id', 'tagName']
            });
            return packageResponse('success', { data }, res);
        }

        const partitionWhere = getPartitionWhere(req.body.partition);
        const contentWhere = { visibleType: { $not: 3 }, ...partitionWhere };
        const codeWhere = { visibleType: { $not: 3 }, ...partitionWhere };

        const [articles, videos, codes] = await Promise.all([
            ArticleModel.findAll({ where: contentWhere, attributes: ['tagList'] }),
            VideoModel.findAll({ where: contentWhere, attributes: ['tagList'] }),
            CodeModel.findAll({ where: codeWhere, attributes: ['tagList'] }),
        ]);

        const tagNames = [...articles, ...videos, ...codes].reduce((result, item) => {
            parseTagList(item.tagList).forEach(tagName => {
                if (tagName) result.add(tagName);
            });
            return result;
        }, new Set());

        if (tagNames.size === 0) {
            return packageResponse('success', { data: [] }, res);
        }

        let data = await TagModel.findAll({
            where: { tagName: { $in: Array.from(tagNames) } },
            attributes: ['id', 'tagName']
        });
        const exists = new Set(data.map(tag => tag.tagName));
        const extra = Array.from(tagNames)
            .filter(tagName => !exists.has(tagName))
            .map(tagName => ({ id: null, tagName }));
        data = [...data, ...extra];
        packageResponse('success', { data }, res);
    }
} 

module.exports = PublicController;
