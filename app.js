require('dotenv').config(); // dotenv 모듈 초기화
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
    messages: [{ role: 'user', content: ': ${userText} 이 다음 내용을 요약해줘\n\n${text}\n` }],
  });
  const endTime = Date.now();  // 종료 시간 기록
  console.log(`텍스트 요약 시간: ${endTime - startTime}ms`);  // 실행 시간 출력
  return response.choices[0].message.content; // 요약된 텍스트 반환
};

const generateImageWithText = async (
  text,
  fontName = "CustomSantteutDotum"
) => {
  const backgroundImagePath = path.join(__dirname, "background.png");

  try {
    const image = await loadImage(backgroundImagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(image, 0, 0, image.width, image.height);

    const fontSize = 12;
    ctx.font = `${fontSize}px "${fontName}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    // 가독성을 위한 그림자 및 윤곽선 설정
    ctx.lineWidth = 3;
    ctx.strokeStyle = "black";
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    const maxWidth = canvas.width * 0.5;
    const lineHeight = fontSize * 1.4; // 조금 넓은 라인 간격 설정
    const textX = canvas.width / 2;
    const startY = canvas.height / 4;

    // 텍스트 배경 박스 색상 및 크기 설정
    const padding = 10;
    const backgroundAlpha = 0.6; // 반투명도 설정
    const backgroundColor = `rgba(0, 0, 0, ${backgroundAlpha})`;

    // 텍스트 줄 바꿈 및 배경 박스 추가 함수
    const wrapTextWithBackground = (ctx, text, x, y, maxWidth, lineHeight) => {
      const lines = text.split("\n");
      let yPos = y;

      for (let i = 0; i < lines.length; i++) {
        const words = lines[i].split(" ");
        let line = "";
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + " ";
          const testWidth = ctx.measureText(testLine).width;
          if (testWidth > maxWidth && line !== "") {
            const textWidth = ctx.measureText(line).width;
            const textHeight = fontSize;
            
            // 배경 박스 그리기
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(x - textWidth / 2 - padding, yPos - padding, textWidth + padding * 2, textHeight + padding * 2);
            
            // 텍스트 그리기
            ctx.fillStyle = "white";
            ctx.strokeText(line, x, yPos);
            ctx.fillText(line, x, yPos);
            line = words[n] + " ";
            yPos += lineHeight;
          } else {
            line = testLine;
          }
        }
        const textWidth = ctx.measureText(line).width;
        const textHeight = fontSize;

        // 마지막 줄 배경 박스 및 텍스트 그리기
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(x - textWidth / 2 - padding, yPos - padding, textWidth + padding * 2, textHeight + padding * 2);

        ctx.fillStyle = "white";
        ctx.strokeText(line, x, yPos);
        ctx.fillText(line, x, yPos);
        yPos += lineHeight;
      }
    };

    wrapTextWithBackground(ctx, text, textX, startY, maxWidth, lineHeight);

    const outputPath = path.join(__dirname, "output.png");
    const buffer = canvas.toBuffer("image/png");
    fs.writeFileSync(outputPath, buffer);
    console.log(`이미지 저장 완료: ${outputPath}`);

    return outputPath;
  } catch (error) {
    console.error("이미지 생성 오류:", error);
    throw new Error("이미지 생성 실패: " + error.message);
  }
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

    const outputImagePath = await generateImageWithText(summarizedText);

    res.json({ 
      success: true, 
      filename: req.file.filename, 
      summary: summarizedText, 
      imagePath: outputImagePath, 
    });
  } catch (err) {
    res.status(400).send('파일 업로드 실패: ' + err.message);
  }
});

// 서버 실행
app.listen(port, () => {
  console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});
