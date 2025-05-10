const express = require('express')
const router = express.Router()
const serviceController = require('../controllers/service')

router.get('/', serviceController.getService);
router.get('/reviews', serviceController.getServiceReviews);

module.exports = router;
