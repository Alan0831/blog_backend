const { code: CodeModel, codeRecord: CodeRecordModel, comment: CommentModel, user: UserModel, tag: TagModel, reply: ReplyModel, friendcircle: FriendCircleModel, privacyarticle: PrivacyArticleModel, sequelize } = require('../models')
const { packageResponse } = require('../utils/packageRespponse')
const joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { find } = require('../controllers/user');
const { findIsCollection } = require('../controllers/collection');
const { logger } = require('../middlewares/logger');
const { DEFAULT_PARTITION, getPartitionWhere } = require('../utils/partition');

const schemaSearchCodeTopic = joi.object({
    id: joi.number().required(),
    owner: joi.number().required(),
    // type: joi.number(), // type 用于区分是否增加浏览次数 1 新增浏览次数 0 不新增
});

const schemaCreateCodeTopic = joi.object({
    title: joi.string().required(),
    content: joi.string().required(),
    tagList: joi.array().required(),
    difficult: joi.number().required(),
    partition: joi.string(),
});

const schemaSubmitMyCode = joi.object({
    codeId: joi.number().required(),
    authorId: joi.number().required(),
    content: joi.string().required(),
});

const schemaSeachCodeList = joi.object({
    codeId: joi.number().required(),
    authorId: joi.number().required(),
});

const schemaSetToAnswer = joi.object({
    codeId: joi.number().required(),
    authorId: joi.number().required(),
    answerId: joi.number().required(),
});

const schemaSearchAnswer = joi.object({
    codeId: joi.number().required(),
    authorId: joi.number().required(),
});

class CodeControllers {
    //  获取代码题目列表
    static async getCodeTopicList(req, res, next) {
        const { pageNum = 1, pageSize = 10, preview = 1, keyword = '', partition } = req.body;
        let codeOrder = [['createdAt', 'DESC']];
        logger.info(`============用户开始请求代码题目列表============`);
        const findParam = {
            where: {
                id: { $not: -1 },   // 过滤关于页面的副本
                visibleType: { $not: 3 },
                ...getPartitionWhere(partition),
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
                // { model: TagModel, attributes: ['name'], where: tagFilter },
                // {
                //     model: CommentModel,
                //     attributes: ['id', 'content', 'createdAt'],
                //     include: [{ model: ReplyModel, attributes: ['id'] }]
                // }
            ],
            offset: (pageNum - 1) * pageSize,
            limit: parseInt(pageSize),
            order: codeOrder,
            row: true,
            distinct: true // count 计算
        };

        const data = await CodeModel.findAndCountAll(findParam);
        if (preview === 1) {
            data.rows.forEach(d => {
                d.content = d.content.slice(0, 500); // 预览模式减少传输数据
            })
        }
        data.pageSize = pageSize;
        data.pageNum = pageNum;
        packageResponse('success', { data }, res);
    }

    // 获取题目详情
    static async findCodeTopicById(req, res, next) {
        const { error } = schemaSearchCodeTopic.validate(req.body);
        if (error) {
            packageResponse('error', { errorMessage: error }, res);
        } else {
            const { id, owner } = req.body;
            logger.info(`============用户请求题目:${id}============`);
            const isCollected = await findIsCollection(owner, id, 3);
            const data = await CodeModel.findOne({
                where: { id },
                // include: [
                //     {
                //         model: CommentModel,
                //         attributes: ['id', 'content', 'createdAt'],
                //         include: [
                //             {
                //                 model: ReplyModel,
                //                 attributes: ['id', 'content', 'createdAt', 'replyUser'],
                //                 include: [{ model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } }],
                //             },
                //             { model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } },
                //         ],
                //         row: true,
                //     },
                //     { model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } },
                // ],
                // order: [[CommentModel, 'createdAt', 'DESC'], [[CommentModel, ReplyModel, 'createdAt', 'ASC']]], // comment model order
                row: true,
            });

            if (data) {
                // 更新点击数和热度
                CodeModel.update({ viewCount: ++data.viewCount, recommend: ++data.recommend }, { where: { id } });
                let _data = { ...data.dataValues, isCollected };
                packageResponse('success', { data: _data }, res);
            } else {
                packageResponse('error', { errorMessage: '该题目已不存在！' }, res);
            }
        }
    }

    // 创建题目
    static async createCodeTopic(req, res, next) {
        const { error } = schemaCreateCodeTopic.validate(req.body);

        if (!error) {
            const { title, content, difficult, tagList = [] } = req.body;
            const result = await CodeModel.findOne({ where: { title } });
            console.log(result);
            logger.info(`============用户开始创建题目============`);
            if (result) {
                logger.info(`============用户创建题目失败，题目已存在============`);
                packageResponse('error', { errorMessage: '创建失败，该题目已存在！' }, res);
            } else {
                try {
                    const tags = tagList || [];
                    // 新增tag标签
                    tags.map(async (item) => {
                        let currentTag = await TagModel.findOne({ where: { tagName: item } });
                        if (!currentTag) {
                            await TagModel.create({ tagName: item });
                        }
                    });
                    // const categories = categoryList.map(c => ({ name: c }))
                    const uuid = uuidv4().toString().replace(/-/g, '');
                    const data = await CodeModel.create(
                        { title, content, tagList: JSON.stringify(tags), difficult, partition: DEFAULT_PARTITION },
                    )

                    packageResponse('success', { data, successMessage: '创建题目成功' }, res);
                } catch (err) {
                    logger.info(`============用户创建题目失败:${err}`);
                    packageResponse('error', { errorMessage: '创建题目失败: ' + err }, res);
                }

            }
        } else {
            packageResponse('error', { errorMessage: '创建题目失败: ' + error }, res);
        }
    }

    // 提交代码
    static async submitMyCode(req, res, next) {
        const { error } = schemaSubmitMyCode.validate(req.body);

        if (!error) {
            const { content, authorId, codeId } = req.body;
            logger.info(`============用户:${authorId}开始提交题目:${codeId}============`);
            try {
                const data = await CodeRecordModel.create(
                    { content, authorId, codeId },
                )
                packageResponse('success', { data, successMessage: '提交题目成功' }, res);
            } catch (err) {
                logger.info(`============用户提交失败:${err}`);
                packageResponse('error', { errorMessage: '提交题目失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '提交题目失败: ' + error }, res);
        }
    }

    // 查询用户提交代码
    static async searchCodeListByUser(req, res, next) {
        const { error } = schemaSeachCodeList.validate(req.body);

        if (!error) {
            const { authorId, codeId } = req.body;
            logger.info(`============用户:${authorId}开始查找题目提交记录:${codeId}============`);
            try {
                const data = await CodeRecordModel.findAndCountAll({
                    where: { authorId, codeId },
                    row: true,
                    order: [['createdAt', 'DESC']],
                    attributes: { exclude: ['updatedAt'] }
                });
                packageResponse('success', { data, successMessage: '成功' }, res);
            } catch (err) {
                logger.info(`============用户提交失败:${err}`);
                packageResponse('error', { errorMessage: '查找记录失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '查找记录失败: ' + error }, res);
        }
    }

    // 设置为答案
    static async setToAnswer(req, res, next) {
        const { error } = schemaSetToAnswer.validate(req.body);

        if (!error) {
            const { authorId, codeId, answerId } = req.body;
            logger.info(`============用户:${authorId}设置题目答案:${codeId}============`);
            try {
                const data = await CodeRecordModel.findAndCountAll({
                    where: { codeId },
                    row: true,
                    order: [['createdAt', 'DESC']],
                    attributes: { exclude: ['updatedAt'] }
                });
                data.rows.forEach((item) => {
                    if (item.id === answerId && item.isAnswer === 0) {
                        CodeRecordModel.update({ isAnswer: 1 }, { where: { id: answerId } });
                    }
                    if (item.id !== answerId && item.isAnswer === 1) {
                        CodeRecordModel.update({ isAnswer: 0 }, { where: { id: item.id } });
                    }
                });
                packageResponse('success', { data, successMessage: '成功' }, res);
            } catch (err) {
                logger.info(`============用户设置失败:${err}`);
                packageResponse('error', { errorMessage: '设置失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '设置失败: ' + error }, res);
        }
    }

    // 取消设置为答案
    static async cancelToAnswer(req, res, next) {
        const { error } = schemaSetToAnswer.validate(req.body);

        if (!error) {
            const { authorId, codeId, answerId } = req.body;
            logger.info(`============用户:${authorId}取消设置题目答案:${codeId}============`);
            try {
                const data = await CodeRecordModel.update({ isAnswer: 0 }, { where: { id: answerId } });
                packageResponse('success', { data, successMessage: '成功' }, res);
            } catch (err) {
                logger.info(`============用户取消设置失败:${err}`);
                packageResponse('error', { errorMessage: '取消设置失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '取消设置失败: ' + error }, res);
        }
    }

    // 查看答案
    static async searchAnswer(req, res, next) {
        const { error } = schemaSearchAnswer.validate(req.body);

        if (!error) {
            const { authorId, codeId } = req.body;
            logger.info(`============用户:${authorId}查看答案:${codeId}============`);
            try {
                const data = await CodeRecordModel.findAndCountAll({
                    where: { codeId, isAnswer: 1 },
                    row: true,
                    order: [['createdAt', 'DESC']],
                    attributes: { exclude: ['updatedAt'] }
                });
                if (data.rows.length > 0) {
                    packageResponse('success', { data: data.rows[0], successMessage: '成功' }, res);
                } else {
                    packageResponse('success', { successMessage: '该题目暂无答案' }, res);
                }
            } catch (err) {
                logger.info(`============用户查看答案失败:${err}`);
                packageResponse('error', { errorMessage: '查看答案失败: ' + err }, res);
            }
        } else {
            packageResponse('error', { errorMessage: '查看答案失败: ' + error }, res);
        }
    }
}

module.exports = CodeControllers;
