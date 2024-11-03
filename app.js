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
    messages: [{ role: 'user', content: `: ${userText} 포스터 형식으로 머리글 기호로 짧게 작성해\n\n${text}\n` }],
  });
  const endTime = Date.now();  // 종료 시간 기록
  console.log(`텍스트 요약 시간: ${endTime - startTime}ms`);  // 실행 시간 출력
  return response.choices[0].message.content; // 요약된 텍스트 반환
};

const generateImageWithText = async (
  text,
  fontName = "CustomSantteutDotum"
) => {
  const backgroundImagePath = path.join(__dirname, "images/background1-2.png");

  try {
    const image = await loadImage(backgroundImagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(image, 0, 0, image.width, image.height);

    let fontSize = 30; // 텍스트 크기를 더 크게 설정
    const maxWidth = canvas.width * 0.4; // 텍스트 영역을 화면의 40%로 설정
    const lineHeight = fontSize * 1.3; // 줄 간격을 약간 줄임

    // 폰트 설정
    ctx.font = `bold ${fontSize}px "${fontName}"`; // 볼드체 설정
    ctx.textAlign = "left"; // 왼쪽 정렬
    ctx.textBaseline = "top"; // 텍스트 위쪽을 기준으로 정렬

    // 텍스트가 길면 폰트 크기 조정
    const adjustFontSizeToFit = (text) => {
      while (ctx.measureText(text).width > maxWidth) {
        fontSize -= 1;
        ctx.font = `bold ${fontSize}px "${fontName}"`;
      }
    };
    adjustFontSizeToFit(text);

    const wrapText = (ctx, text, x, y, maxWidth, lineHeight) => {
      const lines = text.split("\n");
      let yPos = y;

      for (let i = 0; i < lines.length; i++) {
        const words = lines[i].split(" ");
        let line = "";

        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + " ";
          const testWidth = ctx.measureText(testLine).width;

          if (testWidth > maxWidth && line !== "") {
            // 배경 박스 크기 설정 및 그리기
            const padding = 3; // padding을 줄여서 배경 박스 크기를 줄임
            ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
            ctx.fillRect(
              x - padding,
              yPos - padding,
              ctx.measureText(line).width + padding * 2,
              lineHeight + padding
            );

            // 텍스트 그리기
            ctx.fillStyle = "white";
            ctx.fillText(line, x, yPos);
            line = words[n] + " ";
            yPos += lineHeight;
          } else {
            line = testLine;
          }
        }

        // 마지막 줄 배경과 텍스트 그리기
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(
          x - 3,
          yPos - 3,
          ctx.measureText(line).width + 6,
          lineHeight + 6
        );
        ctx.fillStyle = "white";
        ctx.fillText(line, x, yPos);
        yPos += lineHeight;
      }
    };

    const textX = canvas.width * 0.1; // 화면 왼쪽에 텍스트 배치
    const textY = canvas.height * 0.1; // 화면의 상단에 텍스트 시작 위치 조정
    wrapText(ctx, text, textX, textY, maxWidth, lineHeight);

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

// 서버 실행
app.listen(port, () => {
  console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});
