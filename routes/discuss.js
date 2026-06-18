const express = require('express');
const router = express.Router();
const { createComment, deleteComment, updateNotice, getNotice, getNoticeUnreadCount, createVideoComment, deleteVideoComment, getComments } = require('../controllers/discuss')

router.post('/createComment', createComment);
router.post('/deleteComment', deleteComment);
router.post('/updateNotice', updateNotice);
router.post('/getNotice', getNotice);
router.post('/getNoticeUnreadCount', getNoticeUnreadCount);
router.post('/createVideoComment', createVideoComment);
router.post('/deleteVideoComment', deleteVideoComment);
router.get('/comments', getComments);
router.post('/comments', getComments);

module.exports = router
