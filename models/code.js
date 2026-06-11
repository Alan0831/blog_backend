const moment = require('moment')
// code 表
module.exports = (sequelize, dataTypes) => {
  const Code = sequelize.define(
    'code',
    {
      id: { type: dataTypes.INTEGER(11), primaryKey: true, autoIncrement: true },
      title: { type: dataTypes.STRING(255), allowNull: false, unique: true },
      content: { type: dataTypes.TEXT },
      viewCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 阅读数
      goodCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 点赞数
      collectionCount: { type: dataTypes.INTEGER(11), defaultValue: 0 }, // 收藏数
      difficult: { type: dataTypes.INTEGER(11), defaultValue: 5 }, // 难度
      tagList: {type: dataTypes.STRING(255), allowNull: false},
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

  Code.associate = models => {
    // Code.hasMany(models.comment)
    // Code.hasMany(models.reply)
    // Code.belongsTo(models.articleclass, {
    //   foreignKey: 'articleclassId',
    //   targetKey: 'id',
    //   constraints: false
    // });
  }

  return Code
}
