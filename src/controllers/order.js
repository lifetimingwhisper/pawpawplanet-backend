const { dataSource } = require('../db/data-source')
const validation = require('../utils/validation')
const orderHelper = require('../lib/order-helpers')
const paymentHelper = require('../lib/payment-helpers')
const { Not, In } = require('typeorm')
const dayjs = require('dayjs')
const openai = require('../lib/openAI')

async function PostOrderReview(req, res, next) {
  console.log('成功進入 PostOrderReview')

  try {
    const { id: orderId } = req.params
    const reviewerId = req.user.id
    const { rating, comment} = req.body

    if (!orderId || !rating || !comment) {
      return res.status(200).json({
        status: 'error',
        message: '缺少必要欄位 (orderId, rating, comment)',
      })
    }

    const orderRepo = dataSource.getRepository('Order')
    const reviewRepo = dataSource.getRepository('Review')

    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: ['review'],
    })

    if (!order) {
      return res.status(200).json({
        status: 'error',
        message: '找不到該訂單',
      })
    }

    if (order.review) {
      return res.status(200).json({
        status: 'error',
        message: '該訂單已經有評論',
      })
    }

    // const review = reviewRepo.create({
    //   order: { id: orderId },
    //   rating,
    //   comment,
    //   user: { id: reviewerId },           // reviewer 是 user
    //   freelancer: { id: revieweeId },     // 被評論者
    // })

    const revieweeId = order.freelancer_id
    if (!revieweeId || !reviewerId) {
      return res.status(200).json({
        status: 'error',
        message: '缺少必要欄位 (revieweeId, reviewerId)',
      })
    }

    const review = reviewRepo.create({
      order: { id: orderId },
      rating,
      comment,
      reviewer_id: { id: reviewerId },     // reviewer 是 user
      reviewee_id: { id: revieweeId },     // 被評論者
    })

    await reviewRepo.save(review)

    return res.status(200).json({
      status: 'success',
      message: '評論新增成功',
      // data: {
      //   reviewId: review.id,
      //   rating: review.rating,
      //   comment: review.comment,
      // },
    })



  } catch (error) {
    console.error('新增評論失敗:', error)
    next(error)
  }

}

async function patchOrderStatus(req, res, next) {
  try {
    const { id, role } = req.user
    const { action } = req.body
    const orderId = req.params.id

    if (validation.isUndefined(action) || validation.isNotValidSting(action)
      || validation.isUndefined(orderId) || validation.isNotValidSting(orderId)) {
      res.status(200).json({
        status: 'failed',
        message: '欄位未填寫正確'
      })
      return
    }

    let result = orderHelper.checkPermission(role, action)
    if (result.statusCode !== 200) {
      return res.status(result.statusCode).json({
        status: result.status,
        message: result.message
      })
    }

    result = null
    switch (action) {
    case 'accept':
      result = await orderHelper.acceptOrder(id, orderId)
      break
    case 'reject':
      result = await orderHelper.rejectOrder(id, orderId)
      break
    case 'cancel':
      result = await orderHelper.cancelOrder(id, orderId)
      break
    case 'close':
      result = role === orderHelper.USER_ROLES.OWNER ?
        await orderHelper.ownerCloseOrder(id, orderId) : await orderHelper.freelancerCloseOrder(id, orderId)
      break
    case 'complete':
      result = await orderHelper.completeOrder(id, orderId)  
    default:
      console.log('should not reach the default case')
    }

    if (!result) {
      throw new Error('should not happen ... patchOrderStatus() has no result...')
    }

    return res.status(result.statusCode).json({
      status: result.status,
      message: result.message,
      data: result.data
    })
  } catch (error) {
    next(error)
  }
}

async function getOrdersByRole(role, req) {
  try {
    const id = req.user.id
    const loginRole = req.user.role

    if (loginRole !== role) {
      return { statusCode: 200, status: 'failed', message: `未經授權：您的角色 (${loginRole}) 沒有執行此 API 的權限` }
    }

    const tag = parseInt(req.query.tag)
    const limit = parseInt(req.query.limit)
    const page = parseInt(req.query.page)

    if (validation.isUndefined(tag) || validation.isNotValidInteger(tag)
      || validation.isUndefined(limit) || validation.isNotValidInteger(limit) || limit <= 0
      || validation.isUndefined(page) || validation.isNotValidInteger(page) || page <= 0) {
      return { statusCode: 200, status: 'failed', message: '欄位未填寫正確' }
    }

    let result
    switch (tag) {
    case orderHelper.ORDER_CAT_TAG.PENDING.value:
    case orderHelper.ORDER_CAT_TAG.ACCEPTED.value:
    case orderHelper.ORDER_CAT_TAG.PAID.value:
    case orderHelper.ORDER_CAT_TAG.LATEST_RESPONSE.value:
    case orderHelper.ORDER_CAT_TAG.CLOSE.value:
      result = role === orderHelper.USER_ROLES.FREELANCER ?
        await orderHelper.freelancerGetOrders(id, tag, limit, page) :
        await orderHelper.ownerGetOrders(id, tag, limit, page)
      break
    default:
      return { statusCode: 200, status: 'failed', message: `欄位未填寫正確：不支援的 tag(${tag})` }
    }

    if (validation.isNotValidObject(result)) {
      return { statusCode: 200, status: 'failed', message: '伺服器錯誤：getOrdersByRole has no result...' }
    }

    return result
  } catch (error) {
    throw validation.generateError('error', 'getOrdersByRole error', error)
  }
}

// eslint-disable-next-line no-unused-vars
async function PostOrder(req, res, next) {
  console.log('新增訂單API')
  const {
    freelancer_id,
    service_id,
    service_date,
    note,
    pet_id,
    owner_id,
    price,
    price_unit,
    status,
    did_owner_close_the_order,
    did_freelancer_close_the_order

  } = req.body


  try {
    const orderRepository = dataSource.getRepository('Order')

    const existingSameDateServiceOrder = await orderRepository.findOne({
      where: {
        owner_id,
        service_id,
        service_date,
        status: orderHelper.ORDER_STATUS.PENDING
      }
    })
    if (existingSameDateServiceOrder) {
      return res.status(200).json({
        status: 'failed',
        message: '當天已有相同服務的預約，請選擇其他時間'
      })
    }

    const existingOrder = await orderRepository.findOne({
      where: {
        freelancer_id,
        service_date,
        status: In([orderHelper.ORDER_STATUS.ACCEPTED, orderHelper.ORDER_STATUS.PAID]), 
      }
    })

    if (existingOrder) {
      return res.status(200).json({
        status: 'failed',
        message: '該服務人員當日已有預約，請選擇其他時間'
      })
    }

    const newOrder = orderRepository.create({
      freelancer_id,
      service_id,
      pet_id,
      owner_id,
      price,
      price_unit,
      status, // 預設 pending
      did_owner_close_the_order,
      did_freelancer_close_the_order,
      service_date,
      note,

    })

    const savedOrder = await orderRepository.save(newOrder)

    res.status(200).json({
      status: 'success',
      message: '成功新增訂單',
      data: {
        order_id: savedOrder.id
      }
    })

  } catch (err) {
    console.error('建立訂單失敗:', err)
    res.status(500).json({ message: '伺服器錯誤', error: err.message })
  }
}

// 飼主取得當天其他等待付款的訂單清單
async function getOrdersAcceptedOnSameDate(req, res) {
  try {
    const { id, role } = req.user
    const orderId = req.params.id

    if (validation.isUndefined(orderId)) {
      return res.status(200).json({
        status: 'failed',
        message: '欄位未填寫正確'
      })
    }

    if (role !== orderHelper.USER_ROLES.OWNER) {
      return res.status(200).json({
        status: 'failed',
        message: `未經授權：您的角色 (${role}) 沒有執行此 API 的權限`
      })
    }

    const userRepo = dataSource.getRepository('User')
    const orderRepo = dataSource.getRepository('Order')
    const [user, order] = await Promise.all([
      userRepo.findOne({ where: { id } }),
      orderRepo.findOne({ where: { id: orderId } })
    ])
    if (!user || !order || order.status !== orderHelper.ORDER_STATUS.ACCEPTED) {
      return res.status(200).json({
        status: 'failed',
        message: `無法存取訂單：確認訂單是否存在以及訂單狀態是否為 ${orderHelper.ORDER_STATUS.ACCEPTED}`
      })
    }

    const otherOrders = await orderRepo
      .find({
        where: {
          owner_id: id,
          id: Not(order.id),
          service_date: order.service_date,
          status: orderHelper.ORDER_STATUS.ACCEPTED,
        }
      })

    if (otherOrders.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: '成功',
        data: []
      })
    }

    const result = await orderHelper.ownerExpandOrders(user, otherOrders)
    if (validation.isNotValidObject(result)) {
      return res.status(200).json({
        status: 'error',
        message: '伺服器錯誤：ownerExpandOrders has no result...'
      })
    }

    // eslint-disable-next-line no-unused-vars
    // const simplifiedData = result.data.map(({ pet, review, ...rest }) => rest)
    return res.status(result.statusCode).json({
      status: result.status,
      message: result.message,
      data: result.data
    })
  } catch (error) {
    console.error('getOrdersAcceptedOnSameDate error:', error)
    return res.status(500).json({
      status: 'error',
      message: `伺服器錯誤：${error.message}`,
      error
    })
  }
}

// 保姆取得當天其他等待接受的訂單清單
async function getOrdersRequestedOnSameDate(req, res) {
  try {
    const { id, role } = req.user
    const orderId = req.params.id

    if (validation.isUndefined(orderId)) {
      return res.status(200).json({
        status: 'failed',
        message: '欄位未填寫正確'
      })
    }

    if (role !== orderHelper.USER_ROLES.FREELANCER) {
      return res.status(200).json({
        status: 'failed',
        message: `未經授權：您的角色 (${role}) 沒有執行此 API 的權限`
      })
    }

    const userRepo = dataSource.getRepository('User')
    const freelancerRepo = dataSource.getRepository('Freelancer')
    const orderRepo = dataSource.getRepository('Order')
    const [user, freelancer, order] = await Promise.all([
      userRepo.findOne({ where: { id} }),
      freelancerRepo.findOne({ where: { user_id: id} }),
      orderRepo.findOne({ where: { id: orderId } })
    ])

    if (!user || !freelancer || !order
      || order.status !== orderHelper.ORDER_STATUS.PENDING ) {
      return res.status(200).json({
        status: 'failed',
        message: `無法存取訂單：確認訂單是否存在以及訂單狀態是否為 (${orderHelper.ORDER_STATUS.PENDING})`
      })
    }

    const otherOrders = await orderRepo
      .find({
        where: {
          freelancer_id: freelancer.id,
          id: Not(order.id),
          service_date: order.service_date,
          status: orderHelper.ORDER_STATUS.PENDING,
        }
      })

    if (otherOrders.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: '成功',
        data: []
      })
    }

    const freelancerData = { ...freelancer, city: user.city, area: user.area }
    const result = await orderHelper.freelancerExpandOrders(freelancerData, otherOrders)
    if (validation.isNotValidObject(result)) {
      return res.status(200).json({
        status: 'error',
        message: '伺服器錯誤：freelancerExpandOrders has no result...'
      })
    }

    return res.status(result.statusCode).json({
      status: result.status,
      message: result.message,
      data: result.data
    })
  } catch (error) {
    console.error('getOrdersAcceptedOnSameDate error:', error)
    return res.status(500).json({
      status: 'error',
      message: `伺服器錯誤：${error.message}`,
      error
    })
  }
}

async function postOrderPayment(req, res, next) {
  try {
    const { id } = req.user
    const orderId = req.params.id

    if (!orderId) {
      return res.status(200).json({
        status: 'failed',
        message: '欄位未填寫正確'
      })
    }
    
    // 取得 order
    const orderRepo = dataSource.getRepository('Order')
    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: ['service', 'payment'],
    })
    
    if (!order || order.owner_id !== id) {
      res.status(200).json({
        status: 'failed',
        message: '無法存取訂單，不是您的訂單'
      })

      return;
    }
    
    var hasUnpaidPayment = false
    if (order.payment) {
      if (order.payment.success) {
        res.status(200).json({
          status: 'failed',
          message: '已有成功付款的帳單資訊，無法再次付款'
        })

        return;
      } else {
        hasUnpaidPayment = true
      }
    }

    // 準備 payment
    var payment;
    const paymentRepo = dataSource.getRepository('Payment')
    if (!hasUnpaidPayment) {
      payment = paymentRepo.create({
        order_id: orderId,
        amount: order.price,
        paid_at: new Date()
      })

      payment = await paymentRepo.save(payment)
    } else {
      payment = order.payment
      payment.paid_at = new Date()
      payment = await paymentRepo.save(payment)
    }
    
    const result = paymentHelper.prepareECPayData(order, payment)
    if (!result) {
      return res.status(200).json({
        status: 'error',
        message: '伺服器錯誤：prepareECPayData has no result...'
      })
    }
    
    return res.status(result.statusCode).json({
      status: result.status,
      message: result.message,
      data: result.data
    })
  } catch (error) {
    next(error)
  }
}

// 綠界完成付費處理後，在背景通知 backend
async function postECPayResult(req, res, next) {
  try{
    const paymentData = req.body
    const orderId = req.params.id

    if (!orderId || !paymentData) {
      return res.status(200).json({
        status: 'failed',
        message: '綠界未傳送完整金流資訊'
      })
    }

    const orderRepo = dataSource.getRepository('Order')
    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: ['payment']
    })

    if (!order) {
      res.status(200).json({
        status: 'failed',
        message: '無法存取訂單'
      })
    }

    // if (!paymentHelper.validateECPayResultData(data, order, payment)) {
    if (!paymentHelper.validateECPayResultData(paymentData)) {
      res.status(200).json({
        status: 'failed',
        message: '綠界驗證碼驗證失敗'
      })
    }

    if (!order.payment) {
      res.status(200).json({
        status: 'failed',
        message: '無法存取帳單'
      })
    }

    // 再依據 post body 準備 paymentData
    const result = await orderHelper.payTheOrder(order, paymentData)
    if (!result) {
      res.status(200).json({
        status: 'failed',
        message: '綠界驗證碼驗證失敗'
      })
    }

    res.send('1|OK')
    // return res.status(result.statusCode).json({
    //   status: result.status,
    //   message: result.message
    // })
  } catch(error) {
    next(error)
  }
}

// 飼主取得帳單
async function getOrderPayment(req, res, next) {
  try {
    const { id } = req.user
    const orderId = req.params.id

    if (!orderId) {
      return res.status(200).json({
        status: 'failed',
        message: '欄位未填寫正確'
      })
    }

    const orderRepo = dataSource.getRepository('Order')
    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: ['payment']
    })

    if (!order || order.owner_id !== id) {
      res.status(200).json({
        status: 'failed',
        message: '無法存取訂單'
      })
    }

    return res.status(200).json({
      status: 'success',
      message: '成功',
      data: {...order.payment}
    })
  } catch (error) {
    next(error)
  }
}

// 為訂單產生天氣建議（由前端傳送時間地點和服務種類資訊；暫不針對個別訂單 id）
async function generateWeatherAdviceByAI(req, res, next) {
  try {
    const { location, date, service } = req.body

    if (!location || !date || !service) {
      return res.status(200).json({
        status: 'failed',
        message: '提供資訊不足'
      })
    }

    const response = await openai.generateWeatherAdviceByOpenAI(location, date, service)
    return res.status(200).json({
      status: 'success',
      data: {
        message: response.message ?? '抱歉，未產生任何天氣資訊'
      }
    })

  } catch (error) {
    next(error)
  }
}

module.exports = {
  PostOrderReview,
  PostOrder,

  patchOrderStatus,
  getOrdersByRole,
  getOrdersAcceptedOnSameDate,
  getOrdersRequestedOnSameDate,
  postOrderPayment,
  postECPayResult,
  getOrderPayment,
  generateWeatherAdviceByAI
}
