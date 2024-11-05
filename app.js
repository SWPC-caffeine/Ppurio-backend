require('dotenv').config(); // dotenv 모듈 초기화
// const axios = require('axios');
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

// 폰트 등록 (CustomSantteutDotum으로 이름 지정)
const fontDirectory = path.join(
  __dirname,
  "fonts",
  "HanSantteutDotum-Regular.ttf"
);
registerFont(fontDirectory, { family: "CustomSantteutDotum" });

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

const generateImageWithText = async (
  text,
  fontName = "CustomSantteutDotum"
) => {
  const images = [
    "images/1-5/background2-5.png",
    "images/1-5/background2-6.png",
    "images/2-5/background1-1.png",
    "images/2-5/background1-7.png",
  ];

  try {
    for (let i = 0; i < images.length; i++) {
      const imagePath = path.join(__dirname, images[i]);
      const image = await loadImage(imagePath);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");

      ctx.drawImage(image, 0, 0, image.width, image.height);

      let fontSize = canvas.height * 0.15;
      const minFontSize = 15; // 최소 폰트 크기 설정
      const maxWidth = canvas.width * 0.8;
      const lineHeightMultiplier = 2.2;

      ctx.font = `bold ${fontSize}px "${fontName}"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top"; // 텍스트가 기준선 위쪽으로 정렬되도록 설정

      const adjustFontSizeToFit = (text) => {
        while (ctx.measureText(text).width > maxWidth && fontSize > minFontSize) {
          fontSize -= 1;
          ctx.font = `bold ${fontSize}px "${fontName}"`;
        }
      };
      adjustFontSizeToFit(text);

      const wrapTextWithFixedBackground = (ctx, text, x, y, maxWidth, fontSize) => {
        const lineHeight = fontSize * lineHeightMultiplier;
        const lines = [];
        let line = "";
        const words = text.split(" ");
      
        words.forEach((word) => {
          const testLine = line + word + " ";
          const testWidth = ctx.measureText(testLine).width;
      
          if (testWidth > maxWidth && line !== "") {
            lines.push(line.trim());
            line = word + " ";
          } else {
            line = testLine;
          }
        });
        lines.push(line.trim());
      
        // 중앙보다 위쪽에 텍스트를 위치시키기 위해 y 값 조정
        y -= (lines.length * lineHeight) / 2;
      
        // 고정된 배경 박스를 그리기 위한 설정
        const backgroundHeight = canvas.height * 0.5; // 전체 높이의 50%를 배경으로 설정
        const backgroundWidth = canvas.width * 0.8; // 전체 너비의 80%를 배경으로 설정
        const backgroundX = (canvas.width - backgroundWidth) / 2; // 배경을 중앙에 위치시키기 위한 X 좌표
        const backgroundY = (canvas.height - backgroundHeight) / 2; // 배경을 중앙에 위치시키기 위한 Y 좌표
      
        // 불투명한 검정색 배경 그리기
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)"; // 불투명한 검정색 배경
        ctx.fillRect(backgroundX, backgroundY, backgroundWidth, backgroundHeight);
      
        // 텍스트 Y 위치 조정 (배경 중앙에 오도록)
        y = backgroundY + (backgroundHeight - lines.length * lineHeight) * 0.1;
      
        // 각 줄의 텍스트 그리기
        lines.forEach((line) => {
          ctx.fillStyle = "white";
          ctx.fillText(line, x, y);
          y += lineHeight;
        });
      };

      const textX = canvas.width / 2;
      const textY = canvas.height * 0.25; // 텍스트를 화면 상단에 더 가깝게 배치
      wrapTextWithFixedBackground(ctx, text, textX, textY, maxWidth, fontSize);

      const outputPath = path.join(__dirname, `outputs/output${i + 1}.png`);
      const buffer = canvas.toBuffer("image/png");
      fs.writeFileSync(outputPath, buffer);
      console.log(`이미지 저장 완료: ${outputPath}`);
    }
  } catch (error) {
    console.error("이미지 생성 오류:", error);
    throw new Error("이미지 생성 실패: " + error.message);
  }
};

// 홍보 텍스트 작성하는 함수
const createPromotionText = async (summarizedText) => {
  const startTime = Date.now();  // 시작 시간 기록
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: `다음 텍스트를 홍보 메시지로 작성해줘.\n\n${summarizedText}\n` }],
  });
  const endTime = Date.now();  // 종료 시간 기록
  console.log(`\n홍보 텍스트 생성 시간: ${endTime - startTime}ms`);  // 실행 시간 출력
  return response.choices[0].message.content; // 홍보 텍스트 반환
};

// 파일 업로드를 처리하는 라우트
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const userText = req.body.userText;  // 사용자가 입력한 텍스트 받기
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    console.log(userText);
    console.log(filePath);
    const extractedText = await extractTextFromPDF(filePath);
    const summarizedText = await summarizeText(extractedText, userText); // 텍스트 요약 (userText 포함)
    console.log('요약된 내용:' + summarizedText);
    const promotionText = await createPromotionText(summarizedText); // 홍보 텍스트 생성
    console.log('홍보 텍스트: ' + promotionText);

    const outputImagePath = await generateImageWithText(summarizedText);

    res.json({
      success: true,
      filename: req.file.filename,
      summary: summarizedText,
      promotionText: promotionText,
      imagePath: outputImagePath,
    });
  } catch (err) {
    res.status(400).send('파일 업로드 실패: ' + err.message);
  }
});

// OpenAI 인스턴스 방식으로 이미지 프롬프트 생성 및 이미지 요청
app.post('/generate-image', async (req, res) => {
  const { description } = req.body;

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
      res.json({ imageUrls });
  } catch (error) {
      console.error('Error generating image:', error.response ? error.response.data : error.message);
      res.status(500).json({ error: '이미지 생성 중 오류가 발생했습니다.' });
  }
});

// 서버 실행
app.listen(port, () => {
  console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});
