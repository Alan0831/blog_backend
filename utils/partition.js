const Sequelize = require('sequelize');

const DEFAULT_PARTITION = 'codeStudy';
const PARTITIONS = ['codeStudy', 'chatter'];

function normalizePartition(partition, fallback = DEFAULT_PARTITION) {
  const value = String(partition || '').trim();
  if (PARTITIONS.includes(value)) return value;
  return fallback;
}

function getPartitionWhere(partition, fallback = DEFAULT_PARTITION) {
  const normalized = normalizePartition(partition, fallback);
  return normalized ? { partition: normalized } : {};
}

async function ensurePartitionColumns(db) {
  const queryInterface = db.sequelize.getQueryInterface();
  const models = [db.article, db.video, db.code].filter(Boolean);

  for (const model of models) {
    const tableName = model.getTableName();
    const tableInfo = await queryInterface.describeTable(tableName);

    if (!tableInfo.partition) {
      await queryInterface.addColumn(tableName, 'partition', {
        type: Sequelize.DataTypes.STRING(20),
        allowNull: false,
        defaultValue: DEFAULT_PARTITION,
      });
    }

    await model.update(
      { partition: DEFAULT_PARTITION },
      {
        where: {
          [Sequelize.Op.or]: [
            { partition: null },
            { partition: '' },
          ],
        },
      }
    );
  }
}

async function ensureArticleContentColumn(db) {
  if (!db.article) return;

  const queryInterface = db.sequelize.getQueryInterface();
  const tableName = db.article.getTableName();
  const tableInfo = await queryInterface.describeTable(tableName);
  const currentType = String(tableInfo.content && tableInfo.content.type || '').toUpperCase();

  if (!currentType.includes('LONGTEXT')) {
    await queryInterface.changeColumn(tableName, 'content', {
      type: Sequelize.DataTypes.TEXT('long'),
      allowNull: true,
    });
  }
}

module.exports = {
  DEFAULT_PARTITION,
  PARTITIONS,
  normalizePartition,
  getPartitionWhere,
  ensurePartitionColumns,
  ensureArticleContentColumn,
};
