const joi = require('joi');
const { packageResponse } = require('../utils/packageRespponse');
const { logger } = require('../middlewares/logger');

const {
  article: ArticleModel,
  comment: CommentModel,
  reply: ReplyModel,
  user: UserModel,
  notification: NotificationModel,
  videocomment: VideoCommentModel,
  videoreply: VideoReplyModel,
  video: VideoModel,
} = require('../models')

const userAttributes = { exclude: ['updatedAt', 'password'] };

const schemaCreateComment = joi.object({
  articleId: joi.number(),
  userId: joi.number(),
  content: joi.string().required(),
  commentId: joi.number(),
  type: joi.number().required(),
  replyTo: joi.number(),
});

const schemaCreateVideoComment = joi.object({
  videoId: joi.number(),
  userId: joi.number(),
  content: joi.string().required(),
  commentId: joi.number(),
  type: joi.number().required(),
  replyTo: joi.number(),
});

const schemaDeleteComment = joi.object({
  commentId: joi.number(),
  replyId: joi.number(),
  type: joi.number().required(),
});

const schemaSearchNotice = joi.object({
  userId: joi.number().required(),
});

const schemaUpdateNotice = joi.object({
  id: joi.number().required(),
});

const schemaGetComments = joi.object({
  targetType: joi.string().valid('article', 'video').required(),
  targetId: joi.number().required(),
  pageNum: joi.number().min(1).default(1),
  pageSize: joi.number().min(1).max(100).default(20),
});

function getActor(req) {
  const user = req.user || {};
  return {
    userId: user.userId || user.id,
    role: user.role,
    username: user.username,
  };
}

function canDelete(actor, ownerId) {
  return actor.role === 1 || Number(actor.userId) === Number(ownerId);
}

function normalizeUser(user) {
  if (!user) return null;
  const data = user.dataValues || user;
  return {
    id: data.id,
    username: data.username,
    email: data.email,
    description: data.description,
    role: data.role,
    gender: data.gender,
    github: data.github,
    disabledDiscuss: data.disabledDiscuss,
    createdAt: data.createdAt,
  };
}

function normalizeReply(reply) {
  const data = reply.dataValues || reply;
  return {
    id: data.id,
    content: data.content,
    createdAt: data.createdAt,
    user: normalizeUser(data.user),
    replyTo: data.replyTo || null,
    replyUser: data.replyUser || '',
  };
}

function normalizeComment(comment, targetType) {
  const data = comment.dataValues || comment;
  const sourceReplies = targetType === 'video' ? data.videoreplies : data.replies;
  return {
    id: data.id,
    content: data.content,
    createdAt: data.createdAt,
    user: normalizeUser(data.user),
    replyTo: null,
    replyUser: '',
    replies: (sourceReplies || []).map(normalizeReply),
  };
}

function validateCommentContent(content, type) {
  const value = String(content || '').trim();
  if (!value) {
    return { errorCode: 'COMMENT_EMPTY', errorMessage: '评论内容不能为空' };
  }

  const maxLength = type === 1 ? 500 : 300;
  if (value.length > maxLength) {
    return { errorCode: 'COMMENT_TOO_LONG', errorMessage: `评论内容不能超过${maxLength}字` };
  }

  return { value };
}

function sendError(res, errorCode, errorMessage, status = 400) {
  res.status(status);
  packageResponse('error', { errorCode, errorMessage }, res);
}

async function findComments(targetType, targetId, pageNum = 1, pageSize = 20) {
  const isVideo = targetType === 'video';
  const Comment = isVideo ? VideoCommentModel : CommentModel;
  const Reply = isVideo ? VideoReplyModel : ReplyModel;
  const where = isVideo ? { videoId: targetId } : { articleId: targetId };

  const data = await Comment.findAndCountAll({
    where,
    attributes: ['id', 'content', 'createdAt'],
    include: [
      {
        model: Reply,
        attributes: ['id', 'content', 'createdAt', 'replyTo', 'replyUser'],
        include: [{ model: UserModel, as: 'user', attributes: userAttributes }],
      },
      { model: UserModel, as: 'user', attributes: userAttributes },
    ],
    offset: (pageNum - 1) * pageSize,
    limit: parseInt(pageSize),
    order: [['createdAt', 'DESC'], [Reply, 'createdAt', 'ASC']],
    distinct: true,
  });

  const comments = data.rows.map(comment => normalizeComment(comment, targetType));
  return {
    count: data.count,
    rows: comments,
    comments,
    pageNum: Number(pageNum),
    pageSize: Number(pageSize),
  };
}

class DiscussController {
  static find(params) {
    return ArticleModel.findOne({
      where: params,
      attributes: { exclude: ['content'] },
      include: [
        {
          model: CommentModel,
          attributes: ['id', 'content', 'createdAt'],
          include: [
            {
              model: ReplyModel,
              attributes: ['id', 'content', 'createdAt', 'replyTo', 'replyUser'],
              include: [{ model: UserModel, as: 'user', attributes: userAttributes }],
            },
            { model: UserModel, as: 'user', attributes: userAttributes },
          ],
          row: true,
        },
      ],
      order: [[CommentModel, 'createdAt', 'DESC'], [[CommentModel, ReplyModel, 'createdAt', 'ASC']]],
      row: true,
    });
  }

  static findVideo(params) {
    return VideoModel.findOne({
      where: params,
      attributes: { exclude: ['content'] },
      include: [
        {
          model: VideoCommentModel,
          attributes: ['id', 'content', 'createdAt'],
          include: [
            {
              model: VideoReplyModel,
              attributes: ['id', 'content', 'createdAt', 'replyTo', 'replyUser'],
              include: [{ model: UserModel, as: 'user', attributes: userAttributes }],
            },
            { model: UserModel, as: 'user', attributes: userAttributes },
          ],
          row: true,
        },
      ],
      order: [[VideoCommentModel, 'createdAt', 'DESC'], [[VideoCommentModel, VideoReplyModel, 'createdAt', 'ASC']]],
      row: true,
    });
  }

  static async getComments(req, res, next) {
    const params = { ...req.query, ...req.body };
    const { error, value } = schemaGetComments.validate(params);
    if (error) {
      return sendError(res, 'COMMENT_QUERY_INVALID', '评论查询参数错误');
    }

    try {
      const data = await findComments(value.targetType, value.targetId, value.pageNum, value.pageSize);
      packageResponse('success', { data }, res);
    } catch (err) {
      packageResponse('error', { errorCode: 'COMMENT_QUERY_FAILED', errorMessage: '查询评论失败: ' + err }, res);
    }
  }

  static async createComment(req, res, next) {
    const { error } = schemaCreateComment.validate(req.body);
    if (error) {
      return sendError(res, 'COMMENT_PARAM_INVALID', '评论参数错误');
    }

    const actor = getActor(req);
    const { articleId, commentId, type, replyTo } = req.body;
    const validated = validateCommentContent(req.body.content, type);
    if (validated.errorCode) {
      return sendError(res, validated.errorCode, validated.errorMessage);
    }

    try {
      const userId = actor.userId || req.body.userId;
      if (!userId) return sendError(res, 'AUTH_REQUIRED', '请先登录', 401);

      if (type === 1) {
        await CommentModel.create({ userId, articleId, content: validated.value });
        const commentUserData = await UserModel.findOne({ where: { id: userId } });
        const articleData = await ArticleModel.findOne({ where: { id: articleId } });
        if (articleData && commentUserData && articleData.userId != userId) {
          await NotificationModel.create({
            from: userId,
            fromName: commentUserData.username,
            toName: articleData.author,
            content: validated.value,
            articleId,
          });
        }
      } else {
        const commentUserData = await UserModel.findOne({ where: { id: userId } });
        const replyToUserData = await UserModel.findOne({ where: { id: replyTo } });
        const articleData = await ArticleModel.findOne({ where: { id: articleId } });
        await ReplyModel.create({
          userId,
          articleId,
          content: validated.value,
          commentId,
          replyTo,
          replyUser: replyToUserData ? replyToUserData.username : '',
        });
        if (replyToUserData && articleData && commentUserData && replyToUserData.id != userId && articleData.userId != userId) {
          await NotificationModel.create({
            from: userId,
            fromName: commentUserData.username,
            toName: replyToUserData.username,
            content: validated.value,
            articleId,
          });
        }
      }

      const article = await ArticleModel.findOne({ where: { id: articleId } });
      if (article) ArticleModel.update({ recommend: article.recommend + 1 }, { where: { id: articleId } });
      const data = await findComments('article', articleId, 1, 100);
      logger.info(`============用户:${userId}评论文章:${articleId}成功============`);
      packageResponse('success', { data: { comments: data.comments }, successMessage: type === 1 ? '评论成功' : '回复成功' }, res);
    } catch (err) {
      packageResponse('error', { errorCode: 'COMMENT_CREATE_FAILED', errorMessage: '评论失败: ' + err }, res);
    }
  }

  static async createVideoComment(req, res, next) {
    const { error } = schemaCreateVideoComment.validate(req.body);
    if (error) {
      return sendError(res, 'COMMENT_PARAM_INVALID', '评论参数错误');
    }

    const actor = getActor(req);
    const { videoId, commentId, type, replyTo } = req.body;
    const validated = validateCommentContent(req.body.content, type);
    if (validated.errorCode) {
      return sendError(res, validated.errorCode, validated.errorMessage);
    }

    try {
      const userId = actor.userId || req.body.userId;
      if (!userId) return sendError(res, 'AUTH_REQUIRED', '请先登录', 401);

      if (type === 1) {
        await VideoCommentModel.create({ userId, videoId, content: validated.value });
        const commentUserData = await UserModel.findOne({ where: { id: userId } });
        const videoData = await VideoModel.findOne({ where: { id: videoId } });
        if (videoData && commentUserData && videoData.userId != userId) {
          await NotificationModel.create({
            from: userId,
            fromName: commentUserData.username,
            toName: videoData.author,
            content: validated.value,
            videoId,
          });
        }
      } else {
        const commentUserData = await UserModel.findOne({ where: { id: userId } });
        const replyToUserData = await UserModel.findOne({ where: { id: replyTo } });
        const videoData = await VideoModel.findOne({ where: { id: videoId } });
        await VideoReplyModel.create({
          userId,
          videoId,
          content: validated.value,
          videocommentId: commentId,
          replyTo,
          replyUser: replyToUserData ? replyToUserData.username : '',
        });
        if (replyToUserData && videoData && commentUserData && replyToUserData.id != userId && videoData.userId != userId) {
          await NotificationModel.create({
            from: userId,
            fromName: commentUserData.username,
            toName: replyToUserData.username,
            content: validated.value,
            videoId,
          });
        }
      }

      const video = await VideoModel.findOne({ where: { id: videoId } });
      if (video) VideoModel.update({ recommend: video.recommend + 1 }, { where: { id: videoId } });
      const data = await findComments('video', videoId, 1, 100);
      logger.info(`============用户:${userId}评论视频:${videoId}成功============`);
      packageResponse('success', { data: { comments: data.comments }, successMessage: type === 1 ? '评论成功' : '回复成功' }, res);
    } catch (err) {
      packageResponse('error', { errorCode: 'COMMENT_CREATE_FAILED', errorMessage: '评论失败: ' + err }, res);
    }
  }

  static async deleteComment(req, res, next) {
    const { error } = schemaDeleteComment.validate(req.body);
    if (error) {
      return sendError(res, 'COMMENT_DELETE_PARAM_INVALID', '删除评论参数错误');
    }

    const actor = getActor(req);
    const { replyId, commentId, type } = req.body;

    try {
      if (type === 1) {
        const comment = await CommentModel.findOne({ where: { id: commentId } });
        if (!comment) return sendError(res, 'COMMENT_NOT_FOUND', '评论不存在', 404);
        if (!canDelete(actor, comment.userId)) return sendError(res, 'COMMENT_DELETE_FORBIDDEN', '无权删除该评论', 403);

        await ReplyModel.destroy({ where: { commentId } });
        await CommentModel.destroy({ where: { id: commentId } });
        packageResponse('success', { successMessage: '删除评论成功' }, res);
      } else {
        const reply = await ReplyModel.findOne({ where: { id: replyId } });
        if (!reply) return sendError(res, 'COMMENT_NOT_FOUND', '回复不存在', 404);
        if (!canDelete(actor, reply.userId)) return sendError(res, 'COMMENT_DELETE_FORBIDDEN', '无权删除该回复', 403);

        await ReplyModel.destroy({ where: { id: replyId } });
        packageResponse('success', { successMessage: '删除回复成功' }, res);
      }
    } catch (err) {
      packageResponse('error', { errorCode: 'COMMENT_DELETE_FAILED', errorMessage: '删除评论失败: ' + err }, res);
    }
  }

  static async deleteVideoComment(req, res, next) {
    const { error } = schemaDeleteComment.validate(req.body);
    if (error) {
      return sendError(res, 'COMMENT_DELETE_PARAM_INVALID', '删除评论参数错误');
    }

    const actor = getActor(req);
    const { replyId, commentId, type } = req.body;

    try {
      if (type === 1) {
        const comment = await VideoCommentModel.findOne({ where: { id: commentId } });
        if (!comment) return sendError(res, 'COMMENT_NOT_FOUND', '评论不存在', 404);
        if (!canDelete(actor, comment.userId)) return sendError(res, 'COMMENT_DELETE_FORBIDDEN', '无权删除该评论', 403);

        await VideoReplyModel.destroy({ where: { videocommentId: commentId } });
        await VideoCommentModel.destroy({ where: { id: commentId } });
        packageResponse('success', { successMessage: '删除评论成功' }, res);
      } else {
        const reply = await VideoReplyModel.findOne({ where: { id: replyId } });
        if (!reply) return sendError(res, 'COMMENT_NOT_FOUND', '回复不存在', 404);
        if (!canDelete(actor, reply.userId)) return sendError(res, 'COMMENT_DELETE_FORBIDDEN', '无权删除该回复', 403);

        await VideoReplyModel.destroy({ where: { id: replyId } });
        packageResponse('success', { successMessage: '删除回复成功' }, res);
      }
    } catch (err) {
      packageResponse('error', { errorCode: 'COMMENT_DELETE_FAILED', errorMessage: '删除评论失败: ' + err }, res);
    }
  }

  static async getNotice(req, res, next) {
    const { error } = schemaSearchNotice.validate(req.body);
    if (!error) {
      try {
        const { userId } = req.body;
        let replyToUserData = await UserModel.findOne({ where: { id: userId } });
        const data = await NotificationModel.findAndCountAll({ where: { toName: replyToUserData.username }, order: [['createdAt', 'DESC']] });
        packageResponse('success', { data }, res);
      } catch (err) {
        packageResponse('error', { errorMessage: '查询回复失败:' + err }, res);
      }
    } else {
      packageResponse('error', { errorMessage: '查询回复失败:' + error }, res);
    }
  }

  static async updateNotice(req, res, next) {
    const { error } = schemaUpdateNotice.validate(req.body);
    if (!error) {
      try {
        const { id } = req.body;
        NotificationModel.update({ read: 1 }, { where: { id } });
        packageResponse('success', { successMessage: '更新回复状态成功' }, res);
      } catch (err) {
        packageResponse('error', { errorMessage: '更新回复状态失败' + err }, res);
      }
    } else {
      packageResponse('error', { errorMessage: '更新回复状态失败' + error }, res);
    }
  }
}

module.exports = DiscussController
