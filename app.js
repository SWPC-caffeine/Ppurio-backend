require('dotenv').config(); // dotenv 모듈 초기화
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');  // 파일 시스템 모듈
const pdf = require('pdf-parse');  // pdf-parse 모듈
const OpenAI = require('openai'); // OpenAI 모듈
const app = express();
const port = 3000;

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
    const dataBuffer = fs.readFileSync(filePath);
    pdf(dataBuffer).then(data => {
      resolve(data.text);  // 추출된 텍스트 반환
    }).catch(err => {
      reject(err);  // 오류 발생 시 reject
    });
  });
};

// OpenAI를 사용하여 텍스트를 요약하는 함수
const summarizeText = async (text) => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: `다음 내용을 요약해줘\n\n${text}` }],
  });
  return response.choices[0].message.content; // 요약된 텍스트 반환
};

// 파일 업로드를 처리하는 라우트
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    const extractedText = await extractTextFromPDF(filePath);
    const summarizedText = await summarizeText(extractedText); // 텍스트 요약
    console.log('요약된 내용:' + summarizedText);
    // 성공 응답 전송
    res.send(`파일 업로드 성공: ${req.file.filename}\n요약된 내용:\n${summarizedText}`);
  } catch (err) {
    res.status(400).send('파일 업로드 실패: ' + err.message);
  }
});

// 서버 실행
app.listen(port, () => {
  console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});
