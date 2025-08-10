const express = require('express')
const router = express.Router()
const orders = require('../controllers/order')
const authenticateToken = require('../middlewares/auth')


router.post('/:id/review', authenticateToken, orders.PostOrderReview)
router.post('/', authenticateToken, orders.PostOrder)
router.patch('/:id', authenticateToken, orders.patchOrderStatus)
router.get('/:id/same-date/accepted', authenticateToken, orders.getOrdersAcceptedOnSameDate)
router.get('/:id/same-date/requested', authenticateToken, orders.getOrdersRequestedOnSameDate)
router.post('/:id/payment', authenticateToken, orders.postOrderPayment)
router.post('/:id/ecpay-result', orders.postECPayResult)
router.get('/:id/payment', authenticateToken, orders.getOrderPayment)
router.post('/weather-advice', orders.generateWeatherAdviceByAI)

module.exports = router