const joi = require('joi');
const { packageResponse } = require('../utils/packageRespponse');

const {
  article: ArticleModel,
//   tag: TagModel,
//   category: CategoryModel,
  comment: CommentModel,
  reply: ReplyModel,
  user: UserModel,
  notification: NotificationModel,
//   ip: IpModel,
  sequelize
} = require('../models')

const schemaCreateComment = joi.object({
    articleId: joi.number(),
    userId: joi.number().required(),
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

/**
 * 邮件通知
 * userId - 添加评论的用户id
 */
async function sendingEmail(articleId, commentList, commentId, userId) {
  const article = await ArticleModel.findOne({ where: { id: articleId }, attributes: ['id', 'title'] })
  const target = commentList.rows.find(d => d.id === parseInt(commentId))

  const { emailList, html } = getEmailData(article, target, userId)

  Promise.all(emailList.map(receiver => sendEmail({ receiver, html })))
    .then(res => {
      console.log('success to send email')
    })
    .catch(e => {
      console.log('fail to send email')
    })
}

class DiscussController {
  // 查找评论
  static find(params) {
    return ArticleModel.findOne({
      where: params,
      attributes: {exclude: ['content']},
      include: [
        {
            model: CommentModel,
            attributes: ['id', 'content', 'createdAt'],
            include: [
                {
                    model: ReplyModel,
                    attributes: ['id', 'content', 'createdAt'],
                    include: [{ model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } }],
                },
                { model: UserModel, as: 'user', attributes: { exclude: ['updatedAt', 'password'] } },
            ],
            row: true,
        },
      ],
      row: true,
    });
  }

  // 新增评论/回复
  static async createComment(req, res, next) {
    const { error } = schemaCreateComment.validate(req.body);
    if (!error) {
        const { articleId, userId, content, commentId, type, replyTo } = req.body;
        if (type === 1){
          // 添加评论
          try {
            await CommentModel.create({ userId, articleId, content });
            let commentData = await DiscussController.find({id: articleId});  // 该评论详情
            let commentUserData = await UserModel.findOne({ where: {id: userId }}); // 评论人详情
            let articleData = await ArticleModel.findOne({ where: {id: articleId }}); // 评论的文章详情
            // 新建提醒
            await NotificationModel.create({ 
              from: userId, 
              fromName: commentUserData.username, 
              toName: articleData.author, 
              content,
              articleId,
            });
            packageResponse('success', { data: commentData, successMessage: '评论成功' }, res);
          } catch(err) {
            packageResponse('error', {errorMessage: '评论失败：' + err}, res);
          }
        } else{
          // 添加回复
          try {
            await ReplyModel.create({ userId, articleId, content, commentId, replyTo });
            let commentData = await DiscussController.find({id: articleId});
            let commentUserData = await UserModel.findOne({ where: {id: userId }}); // 评论人详情
            let replyToUserData = await UserModel.findOne({ where: {id: replyTo }}); // 被回复人详情
            // 新建提醒
            await NotificationModel.create({ 
              from: userId, 
              fromName: commentUserData.username, 
              toName: replyToUserData.username, 
              content,
              articleId,
            });
            packageResponse('success', { data: commentData, successMessage: '回复成功' }, res);
          } catch(err) {
            packageResponse('error', {errorMessage: '回复失败：' + err}, res);
          }
        }
        // 评论和回复都会加热度
        const data = await ArticleModel.findOne({ where: { id: articleId } });
        ArticleModel.update({ recommend: ++data.recommend }, { where: { id: articleId } });
        
    } else {
      packageResponse('error', {errorMessage: '评论失败:' + error}, res);
    }
  } 

  // 删除评论/回复
  static async deleteComment(req, res, next) {
    const { error } = schemaDeleteComment.validate(req.body);
    if (!error) {
      const { replyId, commentId, type } = req.body;
      // 删除评论
      if (type === 1){
        await sequelize.query(
          `delete comment, reply from comment left join reply on comment.id=reply.commentId where comment.id=${commentId}`
        );
        packageResponse('success', { successMessage: '删除评论成功' }, res);
      } else {
        // 删除回复
        await ReplyModel.destroy({ where: { id: replyId } });
        packageResponse('success', { successMessage: '删除回复成功' }, res);
      }
    } else {
      packageResponse('error', {errorMessage: '删除评论失败:' + error}, res);
    }
  }

  // 查询回复信息
  static async getNotice(req, res, next) {
    const { error } = schemaSearchNotice.validate(req.body);
    if (!error) {
      try {
        const { userId } = req.body;
        let replyToUserData = await UserModel.findOne({ where: {id: userId }}); // 被回复人详情
        const data = await NotificationModel.findAndCountAll({where: {toName: replyToUserData.username}, order: [['createdAt', 'DESC']]});
        packageResponse('success', { data }, res);
      } catch (err) {
        packageResponse('error', {errorMessage: '查询回复失败:' + err}, res);
      }
    } else {
      packageResponse('error', {errorMessage: '查询回复失败:' + error}, res);
    }
  }

  // 标记已读
  static async updateNotice(req, res, next) {
    const { error } = schemaUpdateNotice.validate(req.body);
    if (!error) {
      try {
        const { id } = req.body;
        NotificationModel.update({ read: 1 }, { where: { id } });
        packageResponse('success', { successMessage: '更新回复状态成功' }, res);
      } catch (err) {
        packageResponse('error', {errorMessage: '更新回复状态失败:' + err}, res);
      }
    } else {
      packageResponse('error', {errorMessage: '更新回复状态失败:' + error}, res);
    }
  }
}

module.exports = DiscussController
