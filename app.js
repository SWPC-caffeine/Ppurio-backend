require('dotenv').config(); // dotenv 모듈 초기화
const axios = require('axios');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');  // 파일 시스템 모듈
const pdf = require('pdf-parse');  // pdf-parse 모듈
const OpenAI = require('openai'); // OpenAI 모듈
const app = express();
const port = 3030;
const sharp = require("sharp");
const { createCanvas, loadImage, registerFont } = require("canvas"); // canvas 모듈

app.use(cors());  // CORS 미들웨어를 사용하여 모든 도메인에 요청 허용
app.use(express.json());  // JSON 파싱을 위한 미들웨어 설정
app.use('/images', express.static(path.join(__dirname, 'images')));

// OpenAI API 설정
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,  // 환경 변수에서 API 키 가져오기
});

// Multer 설정: 업로드된 파일을 'uploads' 폴더에 저장
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');  // 저장할 폴더 경로
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));  // 파일 이름 설정
  }
});
const upload = multer({ storage: storage });

// PDF에서 텍스트를 추출하는 함수
const extractTextFromPDF = (filePath) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();  // 시작 시간 기록
    const dataBuffer = fs.readFileSync(filePath);
    pdf(dataBuffer).then(data => {
      const endTime = Date.now();  // 종료 시간 기록
      console.log(`PDF 텍스트 추출 시간: ${endTime - startTime}ms`);
      resolve(data.text);  // 추출된 텍스트 반환
    }).catch(err => {
      reject(err);  // 오류 발생 시 reject
    });
  });
};

// OpenAI를 사용하여 텍스트를 요약하는 함수
const summarizeText = async (text, userText) => {
  const startTime = Date.now();  // 시작 시간 기록
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: `: ${userText} 머리글 기호로 짧게 작성해. 번호 매기지 말고 요약 내용만 바로 출력해\n\n${text}\n` }],
  });
  const endTime = Date.now();  // 종료 시간 기록
  console.log(`텍스트 요약 시간: ${endTime - startTime}ms`);  // 실행 시간 출력
  return response.choices[0].message.content; // 요약된 텍스트 반환
};

// 홍보 텍스트 작성하는 함수 사용할 진 모름(mms 구현하면 사용)
const createPromotionText = async (summarizedText) => {
  const startTime = Date.now();  // 시작 시간 기록
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: `다음 텍스트를 홍보 메시지로 작성해줘.\n\n${summarizedText}\n` }],
  });
  const endTime = Date.now();  // 종료 시간 기록
  console.log(`\n홍보 텍스트 메시지 생성 시간: ${endTime - startTime}ms`);  // 실행 시간 출력
  return response.choices[0].message.content; // 홍보 텍스트 반환
};

// 홍보 포스터 문구 작성하는 함수
const createPosterText = async (summarizedText) => {
  const startTime = Date.now();  // 시작 시간 기록
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: `포스터를 작성할 건데, 그 때 필요한 제목, 날짜, 장소가 있다면 포함해줘, 주요 내용 중에서도 핵심이 되는 내용만을 간단한 형태로 제공해줘 모든 내용은 '-' 로 구분해줘\n\n${summarizedText}\n` }],
  });
  const endTime = Date.now();  // 종료 시간 기록
  console.log(`\n홍보 포스터 텍스트 생성 시간: ${endTime - startTime}ms`);  // 실행 시간 출력
  return response.choices[0].message.content; // 홍보 텍스트 반환
};

// pdf 업로드를 처리하는 라우트
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const userText = req.body.userText;  // 사용자가 입력한 텍스트 받기
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    console.log(userText);
    console.log(filePath);
    const extractedText = await extractTextFromPDF(filePath);
    const summarizedText = await summarizeText(extractedText, userText); // 텍스트 요약 (userText 포함)
    console.log('요약된 내용:' + summarizedText);

    res.json({
      success: true,
      filename: req.file.filename,
      summary: summarizedText,
    });
  } catch (err) {
    res.status(400).send('파일 업로드 실패: ' + err.message);
  }
});

// '\n' 없애기
function removeNewlines(text) {
  return text.replace(/\n/g, '');
}

// pdf 요약된걸 사용자가 수정하고 다음 눌렀을 때
app.post('/create', async (req, res) => {
  try {
    let text = req.body.text;
    text = removeNewlines(text);
    console.log('텍스트'+text);
    console.log('----------------------------------\n');
    const filepath = await generatePrompt(text);
    const textList = await createPosterText(text);
    console.log('파일패스: '+filepath);
    console.log('리스트:' + textList);
    res.json({
      success: true,
      filename: filepath,
      summary: textList,
    });
  } catch (error) {
    res.status(500).send('포스터 생성 실패: ' + error.message);
  }
});

// OpenAI 인스턴스 방식으로 이미지 프롬프트 생성 및 이미지 요청
// 이미지 프롬프트 생성 함수

// 이미지 생성 및 저장 함수
async function generatePrompt(description) {
  try {
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an assistant that generates image prompts for a promotional poster background. 
                    Ensure no text or human figures are in the image. Focus on clean, abstract shapes and 
                    symbolic elements that visually represent the topic. Limit the prompt to 1000 characters.`
        },
        {
          role: "user",
          content: `Generate a creative and visually appealing image prompt for a company’s promotional poster 
                    background based on the following summary, under 1000 characters: ${description}`
        }
      ],
      temperature: 0.5
    });

    const imagePrompt = gptResponse.choices[0].message.content.trim();
    const dalleResponse = await openai.images.generate({
      prompt: imagePrompt,
      n: 4,
      size: "1024x1024"
    });

    const imageUrls = dalleResponse.data.map(item => item.url);
    const savedImagePaths = await downloadImages(imageUrls);
    return savedImagePaths;

  } catch (error) {
    console.error('Error generating image:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// 이미지 다운로드 및 저장 함수
async function downloadImages(urls) {
  const downloadPromises = urls.map(async (url) => {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const timestamp = Date.now();
    const uniqueSuffix = Math.floor(Math.random() * 10000); // 랜덤 숫자 추가
    const imagePath = `images/poster_image_${timestamp}_${uniqueSuffix}.png`;
    fs.writeFileSync(imagePath, response.data);
    return imagePath;
  });
  return Promise.all(downloadPromises);
}



// 서버 실행
app.listen(port, () => {
  console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});
