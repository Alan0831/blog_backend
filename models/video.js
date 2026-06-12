const moment = require('moment')
// video 表
module.exports = (sequelize, dataTypes) => {
  const Video = sequelize.define(
    'video',
    {
      id: { type: dataTypes.INTEGER(11), primaryKey: true, autoIncrement: true },
      author: { type: dataTypes.STRING(50), allowNull: false },
      title: { type: dataTypes.STRING(255), allowNull: false, unique: true },
      videoUrl: { type: dataTypes.STRING(255), allowNull: false },
      content: { type: dataTypes.TEXT },
      viewCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 阅读数
      goodCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 点赞数
      collectionCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 收藏数
      recommend: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 热度
      tagList: {type: dataTypes.STRING(255), allowNull: true},
      partition: { type: dataTypes.STRING(20), allowNull: false, defaultValue: 'codeStudy' },
      poster: {type: dataTypes.STRING(255), allowNull: true}, // 视频封面
      visibleType: {
        type: dataTypes.TINYINT,
        defaultValue: 1,
        comment: '是否上锁:1 - 所有人可见, 2 - 加锁, 3 - 仅自己可见'
      },
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
      }
    },
    {
      timestamps: true
    }
  )

  Video.associate = models => {
    Video.hasMany(models.videocomment)
    Video.hasMany(models.videoreply)
    Video.hasMany(models.collection)
    Video.belongsTo(models.user, {
      foreignKey: 'userId',
      targetKey: 'id',
      constraints: false
    });
  }

  return Video
}
