const moment = require('moment')
// collection 表
module.exports = (sequelize, dataTypes) => {
  const Collection = sequelize.define(
    'collection',
    {
      id: {
        type: dataTypes.INTEGER(11),
        primaryKey: true,
        autoIncrement: true
      },
    //   collectionArticleId: { type: dataTypes.INTEGER(11), defaultValue: 1 }, // 收藏的文章ID
      owner: { type: dataTypes.INTEGER(11), defaultValue: 1 }, // 收藏人ID
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

  Collection.associate = models => {
    Collection.belongsTo(models.article, {
        as: 'article',
        foreignKey: 'articleId',
        targetKey: 'id',
        constraints: false
    });
  }

  return Collection
}
