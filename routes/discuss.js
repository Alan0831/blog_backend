const express = require('express');
const router = express.Router();
const { createComment, deleteComment, updateNotice, getNotice, createVideoComment, deleteVideoComment } = require('../controllers/discuss')

router.post('/createComment', createComment);
router.post('/deleteComment', deleteComment);
router.post('/updateNotice', updateNotice);
router.post('/getNotice', getNotice);
router.post('/createVideoComment', createVideoComment);
router.post('/deleteVideoComment', deleteVideoComment);

module.exports = router
