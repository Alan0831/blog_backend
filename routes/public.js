const express = require('express');
const router = express.Router();
const { getFriendCircle, getTagList } = require('../controllers/public')

router.post('/getFriendCircle', getFriendCircle);
router.post('/getTagList', getTagList);


module.exports = router
