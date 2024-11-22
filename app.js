require("dotenv").config(); // dotenv 모듈 초기화
const axios = require("axios");
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs"); // 파일 시스템 모듈
const pdf = require("pdf-parse"); // pdf-parse 모듈
const OpenAI = require("openai"); // OpenAI 모듈
const bodyParser = require("body-parser");
const app = express();
const port = 3030;
const sharp = require("sharp");
const { createCanvas, loadImage, registerFont } = require("canvas"); // canvas 모듈

app.use(cors()); // CORS 미들웨어를 사용하여 모든 도메인에 요청 허용
app.use(express.json()); // JSON 파싱을 위한 미들웨어 설정
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/edit-images", express.static(path.join(__dirname, "edit-images")));
app.use(bodyParser.json({ limit: "10mb" })); // 이미지 크기에 맞게 limit 조정

app.use(cors({
  origin: "http://localhost:3000", // 클라이언트 도메인 설정
  methods: ["GET", "POST"], // 허용할 HTTP 메서드
  allowedHeaders: ["Content-Type", "Authorization"], // 허용할 헤더
}));

// OpenAI API 설정
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // 환경 변수에서 API 키 가져오기
});

// Multer 설정: 업로드된 파일을 'uploads' 폴더에 저장
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // 저장할 폴더 경로
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // 파일 이름 설정
  },
});

const upload2 = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "edit-images/"); // 파일 저장 경로
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9); // 고유한 파일 이름 생성
      cb(null, `${uniqueSuffix}.jpeg`); // 파일 이름에 .jpeg 확장자 추가
    },
  }),
});

const upload = multer({ storage: storage });
//const upload2 = multer({ dest: "edit-images/" }); // Multer 설정

// PDF에서 텍스트를 추출하는 함수
const extractTextFromPDF = (filePath) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now(); // 시작 시간 기록
    const dataBuffer = fs.readFileSync(filePath);
    pdf(dataBuffer)
      .then((data) => {
        const endTime = Date.now(); // 종료 시간 기록
        console.log(`PDF 텍스트 추출 시간: ${endTime - startTime}ms`);
        resolve(data.text); // 추출된 텍스트 반환
      })
      .catch((err) => {
        reject(err); // 오류 발생 시 reject
      });
  });
};

// OpenAI를 사용하여 텍스트를 요약하는 함수
const summarizeText = async (text, userText) => {
  try {
    const startTime = Date.now(); // 시작 시간 기록
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `: ${userText} 그리고 반드시 머리글 기호로 짧게 작성해. 번호 매기지 말고 요약 내용만 바로 출력해\n\n${text}\n`,
        },
      ],
    });
    const endTime = Date.now(); // 종료 시간 기록
    console.log(`텍스트 요약 시간: ${endTime - startTime}ms`); // 실행 시간 출력
    return response.choices[0].message.content; // 요약된 텍스트 반환
  } catch (error) {
    console.error("텍스트 요약 중 에러 발생:", error.message); // 에러 메시지 출력
    console.error("에러 세부정보:", error); // 자세한 에러 정보 출력
    return "요약을 처리하는 동안 문제가 발생했습니다. 다시 시도해 주세요."; // 사용자에게 반환할 메시지
  }
};


// 홍보 텍스트 작성하는 함수 사용할 진 모름(mms 구현하면 사용)
const createPromotionText = async (summarizedText) => {
  const startTime = Date.now(); // 시작 시간 기록
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "user",
        content: `다음 텍스트를 홍보 메시지로 작성해줘.\n\n${summarizedText}\n`,
      },
    ],
  });
  const endTime = Date.now(); // 종료 시간 기록
  console.log(`\n홍보 텍스트 메시지 생성 시간: ${endTime - startTime}ms`); // 실행 시간 출력
  return response.choices[0].message.content; // 홍보 텍스트 반환
};

// 홍보 포스터 문구 작성하는 함수
const createPosterText = async (summarizedText) => {
  const startTime = Date.now(); // 시작 시간 기록
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "user",
        content: `포스터를 작성할 건데, 그 때 필요한 제목, 날짜, 장소가 있다면 포함해줘, 주요 내용 중에서도 핵심이 되는 내용만을 간단한 형태로 제공해줘 모든 내용은 '-' 로 구분해줘\n\n${summarizedText}\n`,
      },
    ],
  });
  const endTime = Date.now(); // 종료 시간 기록
  console.log(`\n홍보 포스터 텍스트 생성 시간: ${endTime - startTime}ms`); // 실행 시간 출력
  return response.choices[0].message.content; // 홍보 텍스트 반환
};

// pdf 업로드를 처리하는 라우트
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const userText = req.body.userText; // 사용자가 입력한 텍스트 받기
    const filePath = path.join(__dirname, "uploads", req.file.filename);
    console.log(userText);
    console.log(filePath);
    const extractedText = await extractTextFromPDF(filePath);
    const summarizedText = await summarizeText(extractedText, userText); // 텍스트 요약 (userText 포함)
    console.log("요약된 내용:" + summarizedText);

    res.json({
      success: true,
      filename: req.file.filename,
      summary: summarizedText,
    });
  } catch (err) {
    res.status(400).send("파일 업로드 실패: " + err.message);
  }
});

// '\n' 없애기
function removeNewlines(text) {
  return text.replace(/\n/g, "");
}

// pdf 요약된걸 사용자가 수정하고 다음 눌렀을 때
app.post("/create", async (req, res) => {
  try {
    let text = req.body.text;
    text = removeNewlines(text); // '\n' 제거
    console.log("텍스트: " + text);
    console.log("----------------------------------\n");

    // 이미지 URL 생성
    const imageUrls = await generatePrompt(text);

    // 이미지 다운로드 및 저장
    const savedImagePaths = await downloadImages(imageUrls);

    // 텍스트 생성 (포스터 내용)
    const textList = await createPosterText(text);

    const serverUrl = "http://223.194.128.26:3030"; // 서버 IP와 포트를 설정하세요.
    const publicImagePaths = savedImagePaths.map((imagePath) =>
      `${serverUrl}/images/${path.basename(imagePath)}`
    );

    // 저장된 이미지 경로를 ','로 연결
    const joinedImagePaths = publicImagePaths.join(',');
    console.log(joinedImagePaths);

    res.json({
      success: true,
      imageUrls: joinedImagePaths, // ','로 연결된 이미지 경로 반환
      summary: textList, // 요약된 텍스트 반환
    });
  } catch (error) {
    console.error("포스터 생성 실패:", error.message);
    res.status(500).send("포스터 생성 실패: " + error.message);
  }
});


// 이미지 다운로드 및 저장 함수
async function downloadImages(urls) {
  const downloadPromises = urls.map(async (url) => {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const timestamp = Date.now();
    const uniqueSuffix = Math.floor(Math.random() * 10000); // 랜덤 숫자 추가
    const imagePath = `images/poster_image_${timestamp}_${uniqueSuffix}.jpeg`;
    // 이미지 데이터를 Sharp으로 처리하여 JPEG로 변환
    await sharp(response.data)
    .jpeg({ quality: 55 }) // JPEG로 변환 및 품질 설정 (원하는 품질로 조정 가능)
    .toFile(imagePath);
  
    fs.writeFileSync(imagePath, response.data);
    return imagePath;
  });
  return Promise.all(downloadPromises);
}

// 업로드 엔드포인트
app.post("/upload-image", upload2.single("image"), async (req, res) => {
  console.log('upload-image url 호출');
  if (!req.file) {
    return res.status(400).send("파일이 업로드되지 않았습니다.");
  }
  const summarizedText = req.body.summarizedText;
  // summarizedText가 없으면 에러 처리
  if (!summarizedText) {
    return res.status(400).send("summarizedText가 필요합니다.");
  }
  const promotionText = await createPromotionText(summarizedText); // 홍보 메시지 생성
  res.send({
    message: "파일 업로드 성공",
    filePath: `/edit-images/${req.file.filename}`,
    promotionText: promotionText, // 생성된 홍보 메시지 포함
  });
});

// OpenAI 인스턴스 방식으로 이미지 프롬프트 생성 및 이미지 요청
// 이미지 프롬프트 생성 및 URL 반환 함수
async function generatePrompt(description) {
  try {
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `
          You are an assistant that creates image prompts for visually appealing and creative promotional painting backgrounds. 
          Your responses must follow these strict rules:
          1. Do NOT include text, letters, numbers, or symbols in the image description.
          2. The prompt should be concise, focused, and no longer than 1000 characters.
          3. Use abstract shapes, harmonious colors, gradients, and visual elements that convey the theme without relying on text.
          Examples: "A serene gradient sunset over a conceptual abstract ocean, with smooth curves blending into soft pastel hues."
          Avoid: "An image with words like 'Hello'."
          `
        },
        {
          role: "user",
          content: `
          Generate a creative and visually appealing image prompt for a company’s promotional painting background based on the following summary: ${description}.
          `,
        },
      ],
      temperature: 0.5,
    });
    

    const imagePrompt = gptResponse.choices[0].message.content.trim();
    const dalleResponse = await openai.images.generate({
      prompt: imagePrompt,
      n: 4,
      size: "1024x1024",
    });

    const imageUrls = dalleResponse.data.map((item) => item.url);
    console.log('이미지 url 4개 :'+imageUrls);
    return imageUrls;
  } catch (error) {
    console.error(
      "Error generating image:",
      error.response ? error.response.data : error.message
    );
    throw error;
  }
}

const API_URL = "https://message.ppurio.com";
const USER_NAME = "dkdk6517";
const TOKEN = process.env.PPURIO_API_KEY;

// 액세스 토큰 발급 함수
async function getAccessToken() {
  try {
    const response = await axios.post(
      `${API_URL}/v1/token`,
      {},
      {
        auth: {
          username: USER_NAME,
          password: TOKEN,
        },
      }
    );
    console.log('엑세스 토큰 발급 완료');
    return response.data.token;
  } catch (error) {
    console.error("Error getting access token:", error.response?.data || error);
    return null;
  }
}

async function sendMMS(accessToken, messageContent, sender, recipients, fileUrl, fileName) {
  // fileUrl을 로컬 파일 경로로 변환
  const localFilePath = fileUrl.replace('http://223.194.128.26:3030', 'c:\\Users\\LDG\\Desktop\\프캡\\project');
  console.log('c:\\Users\\LDG\\Desktop\\프캡\\project\\'+localFilePath);

  // 로컬 경로에서 파일 읽기
  const image = fs.readFileSync('c:\\Users\\LDG\\Desktop\\프캡\\project\\'+localFilePath);  // 실제 로컬 경로로 파일 읽기
  const base64Image = image.toString('base64');  // Base64로 변환

  const fileData = {
    name: fileName,  // 파일 이름
    size: image.length,  // 파일 크기 (byte 단위)
    data: base64Image,  // Base64 인코딩된 이미지 데이터
  };

  try {
    // 수신자 정보를 targets 배열로 설정
    const targets = recipients.map((recipient) => ({
      to: recipient.to,  // 수신자 번호
      name: recipient.name || "",  // 수신자 이름 (선택적)
      changeWord: recipient.changeWord || "",  // 치환문자 (선택적)
    }));

    const response = await axios.post(
      `${API_URL}/v1/message`,  // 실제 API URL을 사용
      {
        account: USER_NAME,
        messageType: 'MMS',  // MMS 지정
        content: messageContent,  // 메시지 내용
        from: sender,  // 발신번호
        duplicateFlag: 'N',
        rejectType: 'AD',
        refKey: 'ref_key',
        targetCount: recipients.length,  // 수신자 수
        targets: targets,  // 수신자 배열
        files: [fileData],  // Base64로 인코딩된 이미지 데이터 포함
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('메시지 전송 성공');
    return response.data.messageKey;
  } catch (error) {
    console.error('Error sending MMS:', error.response?.data || error);
    return null;
  }
}

app.post("/send-mms", async (req, res) => {
  const { messageContent, sender, recipients, fileUrl, fileName } = req.body;  // 메시지 내용, 발신자, 수신자, 파일 url ,파일 이름

  // 발신자 번호와 수신자 번호가 모두 있는지 확인
  if (!sender || !recipients || recipients.length === 0) {
    return res.status(400).json({ error: "Sender and recipients are required" });
  }

  // fileUrl과 fileName이 모두 있는지 확인
  if (!fileUrl || !fileName) {
    return res.status(400).json({ error: "fileUrl and fileName are required" });
  }

  // 액세스 토큰 발급
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return res.status(500).json({ error: "Failed to get access token" });
  }

  // MMS 전송 함수 호출
  const messageKey = await sendMMS(accessToken, messageContent, sender, recipients, fileUrl, fileName);
  if (!messageKey) {
    return res.status(500).json({ error: "Failed to send MMS" });
  }

  res.json({ messageKey });
});


// 서버 실행
app.listen(port, () => {
  console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});