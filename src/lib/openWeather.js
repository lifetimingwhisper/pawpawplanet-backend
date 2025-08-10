const config = require('../config/index')
const axios = require('axios')

async function getWeatherForecast(city, days = 7) {
  const baseURL = config.get('openWeather.baseURL')
  const apiKey = config.get('openWeather.apiKey')

  try {
    const response = await axios.get(`${baseURL}/forecast`, {
      params: {
        appid: apiKey,
        q: city,
        days: days,
        // aqi: "yes",
        // alerts: "yes",
        lang: "zh_tw",
      },
    });

    return response.data;
  } catch (error) {
    console.error("取得天氣數據時出錯:", error);
    throw error;
  }
}

module.exports = {
  getWeatherForecast
}