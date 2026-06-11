const express = require('express');
const router = express.Router();
const { getCodeTopicList, findCodeTopicById, createCodeTopic, submitMyCode, searchCodeListByUser, setToAnswer, cancelToAnswer, searchAnswer } = require('../controllers/code')

router.post('/getCodeTopicList', getCodeTopicList);
router.post('/findCodeTopicById', findCodeTopicById);
router.post('/createCodeTopic', createCodeTopic);
router.post('/submitMyCode', submitMyCode);
router.post('/searchCodeListByUser', searchCodeListByUser);
router.post('/setToAnswer', setToAnswer);
router.post('/cancelToAnswer', cancelToAnswer);
router.post('/searchAnswer', searchAnswer);

module.exports = router
