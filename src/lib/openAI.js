const config = require('../config/index')
const OpenAI = require('openai');
const openWeather = require('../lib/openWeather')

// 初始化 OpenAI
const singleton = new OpenAI({
  apiKey: config.get('openAI.apiKey'),
});

// 定義可用的函式
const availableFunctions = {
  getOpenWeatherData: {
    type: 'function',
    name: 'getOpenWeatherData',
    description: '依據給定的台灣的某個城市的英文名稱，取得城市包含今天，未來一週的天氣信息',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: "城市名稱，例如 taipei, taichung, kaohsiung",
        },
        days: {
          type: 'integer',
          description: '預報天數 (1-7), 今天是預報天數 1',
        },
      },
      required: ['city'],
    },
  }
}

async function generateWeatherAdviceByOpenAI(location, date, service) {
  try {
    const input = [{
      role: 'user',
      content: `查詢地區 (${location}) 所在城市的英文名稱，並且進一步利用城市名稱找到從今天起開始計算，一週內，共 7 天的天氣資訊`
    }]

    // 第一次 AI 回應
    const response = await singleton.responses.create({
      model: 'gpt-4o',
      instructions: `你是一個天氣助手，可以回答用戶關於天氣的問題。
        當用戶詢問天氣相關問題時，找出其所在區域是台灣的哪個城市以及這個城市的英文名稱，若包含城市和行政區資訊要注意，資訊組合是否正確，(e.g. 台北市北屯，是不存在，錯誤的組合)，
        並以城市為主，
        判斷呼叫 get_weather 函式取得天氣數據。
        使用繁體中文回答，簡潔友善。若資訊不完成或有誤，例如城市不在台灣或只有行政區沒有城市資訊，則回答指定資料有誤，相關天氣訊息無法提供`,
      input,
      tools: [availableFunctions.getOpenWeatherData],
      tool_choice: "auto"
    })

    // 檢查是否有函式被呼叫
    if (response.output && response.output.length > 0) {
      // 檢查是否是天氣查詢
      const getOpenWeatherData_Call = response.output.find(
        (call) => call.name === 'getOpenWeatherData'
      );

      if (getOpenWeatherData_Call) {
        // 取得天氣數據
        const args = JSON.parse(getOpenWeatherData_Call.arguments);
        const city = args.city || "taipei";
        const days = args.days || 7;

        // console.log(`呼叫 openWeather API 取得城市 "${city}" 的天氣數據`);
        const weatherData = await openWeather.getWeatherForecast(city, days);
        console.log('openWeather weatherforecast : ', weatherData)

        // 將結果傳回 AI
        input.push(getOpenWeatherData_Call);
        input.push({
          type: "function_call_output",
          call_id: getOpenWeatherData_Call.call_id,
          output: JSON.stringify(weatherData),
        });

        // 取得最終回答
        const finalResponse = await singleton.responses.create({
          model: "gpt-4o",
          instructions: `你是一個天氣助手，必須優先依據提供的天氣數據，只需要回答用戶指定日期 (${date}) 的天氣。
            使用繁體中文回答，簡潔友善，，回覆的格式，在第一行單獨呈現日期資訊，其他內容包含城市等，則從第二行開始。若提供的天氣數據沒有指定日期的數據，則幫忙產生指定日期的天氣資料
            並依據這個寵物服務媒合平台要從事的活動 (${service}) 給出要注意或準備的事項(例如帶雨衣)，使用攝氏作為氣溫的單位，若有風速資訊則用日常用語，方便理解；
            如果指定日期從今天開始往後算，超過7天(e.g. 今天是2025-08-05，則只能回答 2025-08-05到2025-08-11的資料)，則回答指定日期的資料，無法提供；回答完相關資訊就結束，不需要多餘的問候 e.g. 希望能幫到你，有任何其他問題，隨時告訴我哦`,
          input,
        });

        console.log('openAI final response: ', finalResponse.output_text)
        return {
          city,
          message: finalResponse.output_text,
        };
      }
    }

    // 如果沒有函式呼叫，直接返回 AI 回答
    return {
      message: response.output_text,
    };

  } catch (error) {
    throw error
  }
}

async function generateIntroSuggestionByOpenAI(intro) {
  try {
    const input = [{
      role: 'user',
      content: `基於事實描述，幫助保姆將這段自我介紹 (${intro}) 延展，以溫暖讓人信任的口氣，讓飼主能安心的托付寵物；其中若提到動物請以擬人化的口吻稱呼他們；回覆只要是自介內容，不需要任何其他贅字`
    }]

    // AI 回應
    const response = await singleton.responses.create({
      model: 'gpt-4o',
      instructions: `你是一個天氣助手，可以回答用戶關於天氣的問題。
        當用戶詢問天氣相關問題時，找出其所在區域是台灣的哪個城市以及這個城市的英文名稱，若包含城市和行政區資訊要注意，資訊組合是否正確，(e.g. 台北市北屯，是不存在，錯誤的組合)，
        並以城市為主，
        判斷呼叫 get_weather 函式取得天氣數據。
        使用繁體中文回答，簡潔友善。若資訊不完成或有誤，例如城市不在台灣或只有行政區沒有城市資訊，則回答指定資料有誤，相關天氣訊息無法提供`,
      input,
      temperature: 0.7,
    })

    // 返回 AI 回答
    let originalString = response.output_text;
    // 將所有換行符號替換成空字串
    let cleanedString = originalString.replace(/[\n\r]+/g, '');
   
    return {
      message: cleanedString,
    };

  } catch (error) {
    throw error
  }
}

module.exports = {
  singleton,
  availableFunctions,

  generateWeatherAdviceByOpenAI,
  generateIntroSuggestionByOpenAI
};