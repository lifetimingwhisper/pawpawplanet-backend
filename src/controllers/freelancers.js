// const { P } = require('pino') // fix eslint warnings
const { IsNull, Not } = require('typeorm')
const { dataSource } = require('../db/data-source')
const logger = require('../utils/logger')('FreelancersController')
const orderHelper = require('../lib/order-helpers')
const order = require('./order')
const dayjs = require('dayjs')
const validation = require('../utils/validation')
const districts = require('../data/taiwan-districts.json')
const openai = require('../lib/openAI')

function generateCalendar({ working_days, is_weekly_mode = false, orders = [] }) {
  const today = dayjs()
  const schedule = []

  //先把訂單轉成 map，加速查詢
  const orderMap = new Map()
  orders.forEach(order => {
    const dateStr = dayjs(order.service_date).format('YYYY-MM-DD')
    orderMap.set(dateStr, order.status)//將dateStr當成staus的key
  })

  for (let i = 0; i < 7; i++) {
    const date = today.add(i, 'day')
    const dateStr = date.format('YYYY-MM-DD')
    const weekday = date.day()

    let status = '休假'
    if (working_days.includes(weekday)) {
      status = '可接案'
    }

    //如果有該天的單，依照狀態覆蓋
    if (orderMap.has(dateStr)) {
      const orderStatus = orderMap.get(dateStr)
      if ([1, 2].includes(orderStatus)) {
        status = '有約'  // accepted 或 paid
      } else if (orderStatus === 0) {
        status = '待回覆' //pending
      }
    }

    schedule.push({
      date: dateStr,
      weekday,
      status,
    })
  }

  // 篩出可接案的日期
  const availableDates = schedule
    .filter(item => item.status !== '休假')
    .map(item => item.date)

  return {
    today: today.format('YYYY-MM-DD'),
    start_date: availableDates[0] || null,
    end_date:  availableDates[availableDates.length - 1] || null,
    schedule
  }
}

//取得保姆個人資料
async function getFreelancerProfile(req, res, next) {
  try {
    const { id } = req.user

    if (!req.user) {
      return res.status(200).json({
        status: 'failed',
        message: '認證失敗，請確認登入狀態'
      })
    }

    const freelancerRepo = dataSource.getRepository('Freelancer')
    const serviceRepo = dataSource.getRepository('Service')
    const orderRepo = dataSource.getRepository('Order')

    const profile = await freelancerRepo.findOne({
      where: { user_id: id },
      relations: ['user']
    })

    if (!profile) {
      return res.status(200).json({
        status: 'success',
        data: null
      })
    }
    const { user, ...freelancer } = profile

    const orders = await orderRepo.find({
      where: {
        freelancer_id: profile.id,
        service_date: Not(IsNull())// 保險一點，只查有日期的
      },
      select: ['service_date', 'status']
    })
    const calendar = generateCalendar({
      working_days: profile.working_days,
      // is_weekly_mode: profile.is_weekly_mode,
      orders
    })

    console.log('calendar',calendar)


    const services = await serviceRepo.find({
      where: { freelancer_id: profile.id }
    })

    console.log('services',services)


    res.status(200).json({
      status: 'success',
      message: '操作成功',
      data: {
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        phone: user.phone,
        description: user.description,
        city: user.city,
        area: user.area,
        ...freelancer,
        calendar,
        services: services.map(s => ({
          service_type_id: s.service_type_id,
          title: s.title,
          description: s.description,
          price: s.price,
          price_unit: s.price_unit,
          enabled: s.enabled
        }))
      }
    })
  } catch(error) {
    logger.error('取得保姆資料錯誤:', error)
    next(error)
  }
}

//新增保姆個人資料
async function postFreelancerProfile(req, res, next) {
  try {
    const { id } = req.user
    const {
      name, city, area, phone, description, avatar, //user 欄位
      working_days, is_weekly_mode, bank_account //freelancer 欄位
    } = req.body

    const userRepo = dataSource.getRepository('User')
    const freelancerRepo = dataSource.getRepository('Freelancer')

    const existingUser = await userRepo.findOne({ where: { id } })
    // const existingFreelancer = await freelancerRepo.findOne({ where: { user_id: id } }) // fix eslint warnings

    if (!req.user) {
      return res.status(200).json({
        status: 'failed',
        message: '認證失敗，請確認登入狀態'
      })
    }

    existingUser.name = name
    existingUser.city = city
    existingUser.area = area
    existingUser.phone = phone
    existingUser.description = description
    existingUser.avatar = avatar

    await userRepo.save(existingUser)
    console.log('existingUser', existingUser)

    // 建立 freelancer 資料
    const newFreelancer = freelancerRepo.create({
      user: existingUser,
      working_days,
      is_weekly_mode,
      bank_account
    })

    const savedFreelancer = await freelancerRepo.save(newFreelancer)

    return res.status(200).json({
      status: 'success',
      data: savedFreelancer
    })
  } catch(error) {
    logger.error('新增飼主資料錯誤', error)
    next(error)
  }
}

//編輯保姆個人資料
async function updateFreelancerProfile(req, res, next) {
  try {
    const { id } = req.user
    const {
      name, city, area, phone, description, avatar,
      working_days, is_weekly_mode, bank_account
    } = req.body

    //將地區轉換成經緯度
    let latitude, longitude
    const match = districts.find(item => item.name.includes(city + area))
    if (match) {
      latitude = match.location.lat
      longitude = match.location.lng
    } else {
      return res.status(200).json({
        status: 'failed',
        message: '找不到對應的經緯度資料'
      })
    }

    const userRepo = dataSource.getRepository('User')
    const freelancerRepo = dataSource.getRepository('Freelancer')

    const user = await userRepo.findOne({ where: { id } })
    const freelancer = await freelancerRepo.findOne({ where: { user_id: id } })

    if (!user || !freelancer) {
      return res.status(200).json({ status: 'failed', message: '保姆資料不存在' })
    }

    // 更新 user 資料
    Object.assign(user, { name, city, area, phone, description, avatar })
    await userRepo.save(user)

    // 更新 freelancer 資料
    Object.assign(freelancer, { working_days, is_weekly_mode, bank_account, latitude, longitude })
    await freelancerRepo.save(freelancer)

    res.status(200).json({
      status: 'success',
      data: {
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        phone: user.phone,
        description: user.description,
        city: user.city,
        area: user.area,
        ...freelancer,
      }
    })
  } catch (error) {
    logger.error('更新保姆資料失敗:', error)
    next(error)
  }
}

async function getOrders(req, res, next) {
  try {
    const result = await order.getOrdersByRole(orderHelper.USER_ROLES.FREELANCER, req, res, next)

    if (validation.isNotValidObject(result)) {
      return { statusCode: 200, status: 'failed', message: '伺服器錯誤：getOrders has no result...' }
    }

    const isSuccess = !validation.isNotSuccessStatusCode(result.statusCode)
    return res.status(result.statusCode).json({
      status: result.status,
      message: result.message,
      ...(isSuccess && {
        limit: result.data.limit,
        page: result.data.page,
        total: result.data.total,
        data: result.data.orders,
      })
    })
  } catch (error) {
    next(error)
  }
}
//建立或更新保姆的某個類型服務
async function createOrUpdateService(req, res, next) {
  const { id }  = req.user
  try {
    const {
      enabled, service_type_id, title, description,
      price, price_unit, allowed_pet_types, allowed_pet_ages, allowed_pet_sizes,
      allowed_pet_genders, images, extra_options
    } = req.body

    const validTypes = [0, 1, 2, 3]
    if (!validTypes.includes(service_type_id)) {
      return res.status(200).json({
        status: 'failed',
        message: 'service_type_id 數據錯誤'
      })
    }

    const freelancerRepo = dataSource.getRepository('Freelancer')
    const freelancer = await freelancerRepo.findOneBy({ user_id: id })
    if (!freelancer) {
      return res.status(200).json({ status: 'failed', message: '尚未建立保母資料' })
    }

    const repo = dataSource.getRepository('Service')
    let service = await repo.findOne({
      where: {
        freelancer_id: freelancer.id,
        service_type_id
      }
    })

    if (!service) service = repo.create()

    Object.assign(service, {
      freelancer_id: freelancer.id,
      service_type_id,
      enabled,
      title,
      description,
      price,
      price_unit,
      allowed_pet_types,
      allowed_pet_ages,
      allowed_pet_sizes,
      allowed_pet_genders,
      images,
      extra_options
    })

    const saved = await repo.save(service)
    res.status(200).json({
      status: 'success',
      message: '儲存成功',
      data: saved
    })
  } catch(error) {
    console.error('新增或更新服務失敗：', error)
    next(error)
  }
}

// 查詢保母的某個類型服務
async function getFreelancerServiceDetail(req, res, next) {
  try {
    const { id }  = req.user
    const service_type_id = parseInt(req.params.id, 10)

    const repo = dataSource.getRepository('Service')

    const service = await repo
      .createQueryBuilder('service')
      .leftJoinAndSelect('service.freelancer', 'freelancer')
      .leftJoinAndSelect('freelancer.user', 'user')
      .where('service.service_type_id = :service_type_id', { service_type_id })
      .andWhere('user.id = :userId', { userId: id })
      .getOne()

    if (!service) {
      return res.status(200).json({
        status: 'success', data: null
      })
    }

    const formatted = {
      id: service.id,
      enabled: service.enabled,
      service_type_id: service.service_type_id,
      title: service.title,
      description: service.description,
      price: service.price,
      price_unit: service.price_unit,
      images: service.images,
      allowed_pet_types: service.allowed_pet_types,
      allowed_pet_sizes: service.allowed_pet_sizes,
      allowed_pet_ages: service.allowed_pet_ages,
      allowed_pet_genders: service.allowed_pet_genders,
      extra_options: service.extra_options,
    }

    res.status(200).json({
      status: 'success',
      message: '成功',
      data: formatted
    })
  } catch (error) {
    console.error('查詢保母服務 error:', error)
    next(error)
  }
}

// 飼主取得指定保姆的可接案日期
async function getSchedule(req, res, next) {
  try {
    const { role } = req.user
    const { id: freelancerId } = req.params

    if (!freelancerId) {
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

    const freelancerRepo = dataSource.getRepository('Freelancer')
    const orderRepo = dataSource.getRepository('Order')

    const freelancer = await freelancerRepo.findOne({ where: { id: freelancerId}})
    if (!freelancer) {
      return res.status(200).json({
        status: 'failed',
        message: '無法取得可接案日期：找不到保姆資料'
      })
    }

    const workingDays = freelancer.working_days
    if (!Array.isArray(workingDays)) {
      return res.status(200).json({
        status: 'failed',
        message: '無法取得可接案日期：找不到可接案 weekday'
      })
    }

    const DAYS_AHEAD = 6
    const today = dayjs().tz('Asia/Taipei') // taipeiTime
    const startDayJSDate = today
    const endDayJSDate = today.add(DAYS_AHEAD, 'day')

    const availableDates = []
    for (let i = 0; i <= DAYS_AHEAD; i++) {
      const dayJSDate = today.add(i, 'day')
      if (dayJSDate.isBefore(endDayJSDate.add(1, 'day')) && workingDays.includes(dayJSDate.day())) {
        availableDates.push(dayJSDate.format('YYYY-MM-DD'))
      }
    }

    if (availableDates.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: '成功',
        data: {
          start_date: startDayJSDate.format('YYYY-MM-DD'),
          end_date: endDayJSDate.format('YYYY-MM-DD'),
          available_dates: []
        }
      })
    }

    const orders = await orderRepo
      .createQueryBuilder('order')
      .where('order.freelancer_id = :freelancerId ', { freelancerId })
      .andWhere('order.status IN (:...statuses)', { statuses: [ orderHelper.ORDER_STATUS.ACCEPTED, orderHelper.ORDER_STATUS.PAID ] })
      .andWhere('order.service_date IN (:...dates)', { dates: availableDates })
      .getMany()

    const serviceStrDates = orders.map(order => order.service_date)
      .map(date => dayjs(date).tz('Asia/Taipei').format('YYYY-MM-DD'))
    const resultStrDates = availableDates.filter(strDate => !serviceStrDates.includes(strDate));

    return res.status(200).json({
      status: 'success',
      message: '成功',
      data: {
        start_date: startDayJSDate.format('YYYY-MM-DD'),
        end_date: endDayJSDate.format('YYYY-MM-DD'),
        available_dates: resultStrDates
      }
    })
  } catch (error) {
    console.error('getSchedule error:', error)
    next(error)
  }
}

// 依據保姆個人資料，自動產生自介建議
async function generateIntroSuggestion(req, res, next) {
  try {
    const { intro } = req.body
    if (!intro ) {
      return res.status(200).json({
        status: 'failed',
        message: '提供資訊不足'
      })
    }


    // intro = '非常喜歡小動物，家裡也有許多貓狗，希望有機會提供散步，到府照顧的服務'
    const response = await openai.generateIntroSuggestionByOpenAI(intro)

    return res.status(200).json({
      status: 'success',
      data: {
        message: response.message ?? '抱歉，未產生任何自介建議'
      }
    })
  } catch(error) {
    console.error('getSchedule error:', error)
    next(error)
  }
}

module.exports = {
  getFreelancerProfile,
  postFreelancerProfile,
  updateFreelancerProfile,
  getOrders,
  createOrUpdateService,
  getFreelancerServiceDetail,
  getSchedule,
  generateIntroSuggestion
}
