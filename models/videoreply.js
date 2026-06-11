const moment = require('moment')
// videoreply 表
module.exports = (sequelize, dataTypes) => {
  const VideoReply = sequelize.define(
    'videoreply',
    {
      id: {
        type: dataTypes.INTEGER(11),
        primaryKey: true,
        autoIncrement: true
      },
      content: { type: dataTypes.TEXT, allowNull: false }, // 评论详情
      replyTo: { type: dataTypes.INTEGER(11), defaultValue: 1 }, // 评论对象
      replyUser: { type: dataTypes.STRING(50), allowNull: false, defaultValue: '' }, // 评论对象
      createdAt: {
        type: dataTypes.DATE,
        defaultValue: dataTypes.NOW,
        get() {
          return moment(this.getDataValue('createdAt')).format('YYYY-MM-DD HH:mm:ss')
        }
      },
      updatedAt: {
        type: dataTypes.DATE,
        defaultValue: dataTypes.NOW,
        get() {
          return moment(this.getDataValue('updatedAt')).format('YYYY-MM-DD HH:mm:ss')
        }
      },
    },
    {
      timestamps: true
    }
  )

  VideoReply.associate = models => {
    VideoReply.belongsTo(models.user, {
      foreignKey: 'userId',
      targetKey: 'id',
      constraints: false
    });
    VideoReply.belongsTo(models.videocomment, {
      foreignKey: 'videocommentId',
      targetKey: 'id',
      constraints: false
    });
  }

  return VideoReply
}
