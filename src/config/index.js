const dotenv = require('dotenv')

// 僅在非 production 環境時才載入 .env 檔案
if (process.env.NODE_ENV !== 'production') {
  const result = dotenv.config()
  if (result.error) {
    
    console.warn('[Warning] Failed to load .env:', result.error)
  }
}
const web = require('./web')
const db = require('./db')
const secret = require('./secret')
const ecpay = require('./ecpay')
const openAI = require('./openAI')
const openWeather = require('./openWeather')

const config = {
  web,
  db,
  secret,
  ecpay,
  openAI,
  openWeather
}

class ConfigManager {
  /**
   * Retrieves a configuration value based on the provided dot-separated path.
   * Throws an error if the specified configuration path is not found.
   *
   * @param {string} path - Dot-separated string representing the configuration path.
   * @returns {*} - The configuration value corresponding to the given path.
   * @throws Will throw an error if the configuration path is not found.
   */
  static get (path) {
    if (!path || typeof path !== 'string') {
      throw new Error(`incorrect path: ${path}`)
    }
    const keys = path.split('.')
    let configValue = config
    keys.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(configValue, key)) {
        throw new Error(`config ${path} not found`)
      }
      configValue = configValue[key]
    })
    return configValue
  }
}

module.exports = ConfigManager