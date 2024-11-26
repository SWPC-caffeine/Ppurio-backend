require("dotenv").config(); 
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

app.use(cors()); // CORS 미들웨어를 사용하여 모든 도메인에 요청 허용
app.use(express.json()); // JSON 파싱을 위한 미들웨어 설정
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/edit-images", express.static(path.join(__dirname, "edit-images")));
app.use(bodyParser.json({ limit: "10mb" })); // 이미지 크기에 맞게 limit 조정

app.use(cors({
  origin: "http://localhost:3000", 
  methods: ["GET", "POST"], 
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// OpenAI API 설정
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// pdf 파일 업로드 multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); 
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// 이미지 생성 업로드 multer 설정
const upload2 = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "edit-images/"); 
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, `${uniqueSuffix}.jpeg`); 
    },
  }),
});

const upload = multer({ storage: storage });

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
        reject(err);
      });
  });
};

// OpenAI를 사용하여 텍스트를 요약하는 함수
const summarizeText = async (text, userText) => {
  try {
    const startTime = Date.now(); // 시작 시간 기록
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", 
      messages: [
        {
          role: "user",
          content: `
        당신은 마케팅 전문가입니다. 아래의 정보를 바탕으로 깔끔하고 현대적인 포스터 텍스트를 작성하세요. 각 항목은 머리글 기호(-)로 시작하며 한 줄씩 나누어 작성하세요.

        작성 규칙:
          1. 불필요한 형식(예: 별모양, 특수기호 등)을 사용하지 마세요.
          2. 간결하고 직접적인 문구를 사용하세요.
          3. 각 정보는 한 줄로 요약하세요.
          4. 현대적이고 가독성 높은 톤을 유지하세요.

        포스터 구성 요소:
        - 제목: 한 문장으로 핵심 메시지를 전달.
        - 핵심 정보: 행사 이름, 날짜/시간, 장소, 가격 정보.
        - 주요 혜택: 소비자가 관심을 가질 이유를 나열.
        - 문의 사항 및 링크: 이메일, 연락처, 등록 링크 등.

        사용자 요구사항:
        ${userText}

        입력된 정보:  
        ${text}
        `,
        },
      ],
    });
    const endTime = Date.now();
    console.log(`텍스트 요약 시간: ${endTime - startTime}ms`);

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("텍스트 요약 중 에러 발생:", error.message);
    return "요약을 처리하는 동안 문제가 발생했습니다. 다시 시도해 주세요.";
  }
};

// 홍보 텍스트 작성하는 함수 (mms 구현하면 사용)
const createPromotionText = async (summarizedText) => {
  const startTime = Date.now(); // 시작 시간 기록
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `포스터를 작성할 건데, 그 때 필요한 제목, 날짜, 장소가 있다면 포함해줘, 주요 내용 중에서도 핵심이 되는 내용만을 간단한 형태로 제공해줘 모든 내용은 '-' 로 구분해줘\n\n${summarizedText}\n`,
        },
      ],
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error in createPosterText:", error.message);
    return "- 텍스트 생성 실패";
  }
};


// pdf 업로드를 처리하는 라우트
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const userText = req.body.userText; // 사용자가 입력한 텍스트 받기
    const filePath = path.join(__dirname, "uploads", req.file.filename);
    console.log(userText);
    console.log(filePath);
    const extractedText = await extractTextFromPDF(filePath);  // pdf에서 텍스트 추출
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
    let text = req.body.text || '';
    text = removeNewlines(text).trim(); // '\n' 제거 및 트림 처리
    console.log("텍스트: ", text);

    // Step 1: 이미지 URL 생성 및 텍스트 생성 (병렬 처리)
    const [imageUrls, textList] = await Promise.all([
      generatePrompt(text),  // 이미지 URL 생성
      createPosterText(text) // 포스터 텍스트 생성
    ]);

    // Step 2: 이미지 다운로드
    const savedImagePaths = await downloadImages(imageUrls);

    // Step 3: 이미지 URL 생성
    const serverUrl = process.env.REACT_APP_SERVER_IP; // 서버 IP와 포트
    const publicImagePaths = savedImagePaths.map((imagePath) =>
      `${serverUrl}/images/${path.basename(imagePath)}`
    );

    // Step 4: 응답 반환
    res.json({
      success: true,
      imageUrls: publicImagePaths.join(','),
      summary: textList // 요약된 텍스트 반환
    });
  } catch (error) {
    console.error("포스터 생성 실패:", error.message);
    res.status(500).send("포스터 생성 실패: " + error.message);
  }
});

// 이미지 다운로드 및 저장 함수
async function downloadImages(urls) {
  return Promise.all(
    urls.map(async (url) => {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      const timestamp = Date.now();
      const uniqueSuffix = Math.floor(Math.random() * 10000);
      const imagePath = `images/poster_image_${timestamp}_${uniqueSuffix}.jpeg`;

      await sharp(response.data)
        .jpeg({ quality: 50 })
        .toFile(imagePath);

      return imagePath;
    })
  );
}

// 포스터 업로드
app.post("/upload-image", upload2.single("image"), async (req, res) => {
  console.log("upload-image url 호출");

  if (!req.file) {
    return res.status(400).send("파일이 업로드되지 않았습니다.");
  }
  const summarizedText = req.body.summarizedText;
  if (!summarizedText) {
    return res.status(400).send("summarizedText가 필요합니다.");
  }

  try {
    const uploadedFileName = req.file.filename; 
    const outputDir = path.join(__dirname, 'edit-images');
    const outputFileName = path.join(outputDir, uploadedFileName); 

    console.log('최종파일: ' + outputFileName);

    const imageBuffer = await sharp(req.file.path)
      .jpeg({ quality: 100 }) // JPEG 품질 설정 (100%)
      .toBuffer();  

    fs.writeFileSync(outputFileName, imageBuffer);  // 변환된 버퍼를 파일로 저장

    const promotionText = await createPromotionText(summarizedText); // 홍보 메시지 생성
    res.send({
      message: "파일 업로드 성공",
      filePath: `/edit-images/${uploadedFileName}`,
      promotionText: promotionText, // 생성된 홍보 메시지 포함
    });
  } catch (error) {
    console.error("이미지 처리 오류:", error);
    res.status(500).send("이미지 처리 중 오류가 발생했습니다.");
  }
});

// OpenAI 인스턴스 방식으로 이미지 프롬프트 생성 및 이미지 요청
// 이미지 프롬프트 생성 및 URL 반환 함수
async function generatePrompt(description) {
  try {
    // GPT-4o를 사용하여 이미지 프롬프트 생성
    const gptResponse = await openai.chat.completions.create({
      model: "o1-preview",
      messages: [
        {
          role: "user",
          content: `
          You are an assistant that generates precise image prompts for a promotional poster background. 
          Ensure the image contains no text, letters, numbers, symbols, or words. 
          Focus solely on abstract, clean shapes, harmonious colors, and symbolic elements. 
          Avoid any elements that could be misinterpreted as text or numbers. 
          The design should be modern, minimalist, and visually appealing.

          Generate a creative and visually appealing image prompt for a company’s promotional poster 
                    background based on the following summary: ${description}`,
        },
      ],
    });

    const imagePrompt = gptResponse.choices[0].message.content.trim();

    // DALL-E 3를 사용하여 이미지 생성
    const dalleResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
      style: "natural"
    });

    console.log("Generated Image Prompt:", imagePrompt);
    return dalleResponse.data.map((item) => item.url);
  } catch (error) {
    console.error("Error in generatePrompt:", error.response?.data || error.message);
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
  const serverIp = process.env.REACT_APP_SERVER_IP;
  if (!serverIp) {
    throw new Error('Server IP is not defined in the .env file.');
  }
  const localFilePath = path.resolve(__dirname, 'c:\\Users\\LDG\\Desktop\\프캡\\project\\edit-images', fileName);

  // 로컬 경로에서 파일 읽기
  const image = fs.readFileSync(localFilePath);  // 실제 로컬 경로로 파일 읽기
  const base64Image = image.toString('base64');  // Base64로 변환

  const fileData = {
    name: fileName, 
    size: image.length, 
    data: base64Image, 
  };

  try {
    const targets = recipients.map((recipient) => ({
      to: recipient.to,  // 수신자 번호
      name: recipient.name || "",  // 수신자 이름 (선택적)
      changeWord: recipient.changeWord || "",  // 치환문자 (선택적)
    }));

    const response = await axios.post(
      `${API_URL}/v1/message`, 
      {
        account: USER_NAME,
        messageType: 'MMS', 
        content: messageContent,  
        from: sender,  
        duplicateFlag: 'N',
        rejectType: 'AD',
        refKey: 'ref_key',
        targetCount: recipients.length,  
        targets: targets,  
        files: [fileData], 
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

app.listen(port, () => {
  console.log(`서버가 포트 ${port}에서 실행 중입니다.`);
});