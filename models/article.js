const moment = require('moment')
// article 表
module.exports = (sequelize, dataTypes) => {
  const Article = sequelize.define(
    'article',
    {
      id: { type: dataTypes.INTEGER(11), primaryKey: true, autoIncrement: true },
      author: { type: dataTypes.STRING(50), allowNull: false },
      title: { type: dataTypes.STRING(255), allowNull: false, unique: true },
      content: { type: dataTypes.TEXT },
      viewCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 阅读数
      goodCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 点赞数
      collectionCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 收藏数
      recommend: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 热度
      tagList: {type: dataTypes.STRING(255), allowNull: false},
      isLock: {
        type: dataTypes.TINYINT,
        defaultValue: 1,
        comment: '是否上锁:1 - 未上锁, 2 - 加锁'
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

  Article.associate = models => {
    // Article.hasMany(models.tag)
    // Article.hasMany(models.category)
    Article.hasMany(models.comment)
    Article.hasMany(models.reply)

    Article.belongsTo(models.user, {
      foreignKey: 'userId',
      targetKey: 'id',
      constraints: false
    });
    Article.belongsTo(models.articleclass, {
      foreignKey: 'articleclassId',
      targetKey: 'id',
      constraints: false
    });
  }

  return Article
}
