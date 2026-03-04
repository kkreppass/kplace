import express from "express";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { parseString } from "xml2js";
import path from "path";
import { fileURLToPath } from "url";
import { constants as fsConstants } from "fs";
import { deflateSync, inflateSync } from "zlib";
import bcrypt from "bcrypt";
import session from "express-session";
import nodemailer from "nodemailer";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const BASE_PORT = Number(process.env.PORT) || 3000;
const skipEmail = true;
const PIXEL_LIMIT_PER_HOUR = 100;
const PIXEL_LIMIT_WINDOW_MS = 1000 * 60 * 60;

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(chunkType, chunkData) {
  const typeBuffer = Buffer.from(chunkType);
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(chunkData.length, 0);

  const crcBuffer = Buffer.alloc(4);
  const crcValue = crc32(Buffer.concat([typeBuffer, chunkData]));
  crcBuffer.writeUInt32BE(crcValue, 0);

  return Buffer.concat([lengthBuffer, typeBuffer, chunkData, crcBuffer]);
}

function createBlankPng(width, height) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const rowLength = width * 4 + 1;
  const rawData = Buffer.alloc(rowLength * height, 0);
  for (let row = 0; row < height; row += 1) {
    rawData[row * rowLength] = 0;
  }

  const idatData = deflateSync(rawData);

  const ihdr = createPngChunk("IHDR", ihdrData);
  const idat = createPngChunk("IDAT", idatData);
  const iend = createPngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

const EMPTY_GRID_IMAGE_64 = createBlankPng(64, 64);

function parseColor(colorStr) {
  const r = parseInt(colorStr.slice(1, 3), 16);
  const g = parseInt(colorStr.slice(3, 5), 16);
  const b = parseInt(colorStr.slice(5, 7), 16);
  return { r, g, b, a: 255 };
}

function decodePng(pngBuffer) {
  let offset = 8;

  let width = 0;
  let height = 0;
  const idatChunks = [];

  while (offset < pngBuffer.length) {
    const chunkLength = pngBuffer.readUInt32BE(offset);
    const chunkType = pngBuffer.toString("ascii", offset + 4, offset + 8);
    const chunkData = pngBuffer.subarray(offset + 8, offset + 8 + chunkLength);

    if (chunkType === "IHDR") {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
    } else if (chunkType === "IDAT") {
      idatChunks.push(chunkData);
    } else if (chunkType === "IEND") {
      break;
    }

    offset += 12 + chunkLength;
  }

  const compressedData = Buffer.concat(idatChunks);
  const rawData = inflateSync(compressedData);

  const rgba = Buffer.alloc(width * height * 4);
  const bytesPerPixel = 4;
  const scanlineLength = width * bytesPerPixel;

  for (let y = 0; y < height; y++) {
    const filterType = rawData[y * (scanlineLength + 1)];
    const scanline = rawData.subarray(
      y * (scanlineLength + 1) + 1,
      (y + 1) * (scanlineLength + 1),
    );

    if (filterType === 0) {
      scanline.copy(rgba, y * scanlineLength);
    }
  }

  return { width, height, rgba };
}

function encodePngFromRgba(width, height, rgbaBuffer) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const rowLength = width * 4 + 1;
  const rawData = Buffer.alloc(rowLength * height);
  for (let row = 0; row < height; row++) {
    rawData[row * rowLength] = 0;
    rgbaBuffer.copy(
      rawData,
      row * rowLength + 1,
      row * width * 4,
      (row + 1) * width * 4,
    );
  }

  const idatData = deflateSync(rawData);

  const ihdr = createPngChunk("IHDR", ihdrData);
  const idat = createPngChunk("IDAT", idatData);
  const iend = createPngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

async function ensureHighlightPng() {
  const highlightPath = path.join(__dirname, "public", "highlight.png");
  try {
    await access(highlightPath, fsConstants.F_OK);
  } catch {
    const signature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(1, 0);
    ihdrData.writeUInt32BE(1, 4);
    ihdrData[8] = 8;
    ihdrData[9] = 6;
    ihdrData[10] = 0;
    ihdrData[11] = 0;
    ihdrData[12] = 0;

    const rawData = Buffer.from([0, 255, 255, 0, 255]);
    const idatData = deflateSync(rawData);

    const ihdr = createPngChunk("IHDR", ihdrData);
    const idat = createPngChunk("IDAT", idatData);
    const iend = createPngChunk("IEND", Buffer.alloc(0));

    const pngBuffer = Buffer.concat([signature, ihdr, idat, iend]);
    await writeFile(highlightPath, pngBuffer);
    console.log("highlight.png created");
  }
}

ensureHighlightPng();

const USERS_FILE = path.join(__dirname, "users.json");
const EMAIL_TOKENS_FILE = path.join(__dirname, "email-tokens.json");

async function loadUsers() {
  try {
    const data = await readFile(USERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveUsers(users) {
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

async function loadEmailTokens() {
  try {
    const data = await readFile(EMAIL_TOKENS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveEmailTokens(tokens) {
  await writeFile(EMAIL_TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

let emailTransporter;

async function setupEmailTransporter() {
  const testAccount = await nodemailer.createTestAccount();

  emailTransporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  console.log("Email transporter configured (Ethereal test account)");
  console.log("Email user:", testAccount.user);
}

app.use(express.json({ limit: "50mb" }));

app.use(
  session({
    secret: crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }
  next();
}

function countValidPixelsForLimit(cellUpdates) {
  let validPixels = 0;

  for (const update of cellUpdates) {
    const cellId = String(update?.cellId || "");
    const pixels = Array.isArray(update?.pixels) ? update.pixels : [];

    if (!/^[0-9]+-[0-9]+$/.test(cellId)) {
      continue;
    }

    for (const pixel of pixels) {
      const x = parseInt(pixel?.x);
      const y = parseInt(pixel?.y);
      const color = pixel?.color;

      if (
        isNaN(x) ||
        isNaN(y) ||
        x < 0 ||
        x >= 64 ||
        y < 0 ||
        y >= 64 ||
        typeof color !== "string"
      ) {
        continue;
      }

      validPixels += 1;
    }
  }

  return validPixels;
}

function getPixelWindowUsage(user, now = Date.now()) {
  const windowStart = Number(user?.pixelCountWindowStart || 0);
  const windowExpired =
    !windowStart || now - windowStart >= PIXEL_LIMIT_WINDOW_MS;
  const usedPixelsThisHour = windowExpired
    ? 0
    : Number(user?.pixelCountThisWindow || 0);

  return {
    windowStart: windowExpired ? now : windowStart,
    usedPixelsThisHour,
    remainingPixelsThisHour: Math.max(
      0,
      PIXEL_LIMIT_PER_HOUR - usedPixelsThisHour,
    ),
    limitPerHour: PIXEL_LIMIT_PER_HOUR,
    windowExpired,
  };
}

app.post("/api/auth/register", async (req, res) => {
  try {
    console.log("Registration request received");
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
      return res.status(400).json({ error: "모든 필드를 입력해주세요" });
    }

    console.log("Validating email:", email);

    if (!email.endsWith("@kaist.ac.kr")) {
      return res.status(400).json({ error: "KAIST 이메일만 사용 가능합니다" });
    }

    const emailRegex = /^[^\s@]+@kaist\.ac\.kr$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "유효하지 않은 이메일 형식입니다" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ error: "비밀번호는 6자 이상이어야 합니다" });
    }

    console.log("Loading users...");
    const users = await loadUsers();

    if (users.find((u) => u.email === email)) {
      return res.status(400).json({ error: "이미 사용 중인 이메일입니다" });
    }

    console.log("Hashing password...");
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log("Creating user object...");
    const newUser = {
      id: Date.now(),
      email,
      username,
      password: hashedPassword,
      emailVerified: skipEmail,
      createdAt: new Date().toISOString(),
    };

    console.log("Saving user...");
    users.push(newUser);
    await saveUsers(users);

    if (skipEmail) {
      return res.json({
        message: "회원가입이 완료되었습니다. 이메일 인증이 스킵되었습니다.",
        emailPreviewUrl: null,
      });
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");

    console.log("Saving verification token...");
    const tokens = await loadEmailTokens();
    tokens[verificationToken] = {
      userId: newUser.id,
      email,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24,
    };
    await saveEmailTokens(tokens);

    console.log("Sending verification email...");
    const verificationUrl = `http://localhost:${BASE_PORT}/api/auth/verify-email?token=${verificationToken}`;

    res.json({
      message:
        "회원가입이 완료되었습니다. 이메일을 확인하여 인증을 완료해주세요.",
      emailPreviewUrl: null,
    });

    setImmediate(async () => {
      try {
        const info = await emailTransporter.sendMail({
          from: '"Kplace" <noreply@kplace.com>',
          to: email,
          subject: "이메일 인증",
          html: `
            <h2>Kplace 가입 인증 이메일</h2>
            <p>아래 링크를 클릭하여 이메일 인증을 완료해주세요.</p>
            <a href="${verificationUrl}">${verificationUrl}</a>
            <p>24시간 동안 유효합니다.</p>
          `,
        });

        console.log(
          "Verification email sent:",
          nodemailer.getTestMessageUrl(info),
        );
      } catch (emailError) {
        console.error("Email sending failed:", emailError);
      }
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "회원가입에 실패했습니다" });
  }
});

app.get("/api/auth/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send("<h1>유효하지 않은 인증 링크입니다</h1>");
    }

    const tokens = await loadEmailTokens();
    const tokenData = tokens[token];

    if (!tokenData) {
      return res.status(400).send("<h1>유효하지 않은 인증 링크입니다</h1>");
    }

    if (Date.now() > tokenData.expiresAt) {
      delete tokens[token];
      await saveEmailTokens(tokens);
      return res.status(400).send("<h1>인증 링크가 만료되었습니다</h1>");
    }

    const users = await loadUsers();
    const user = users.find((u) => u.id === tokenData.userId);

    if (!user) {
      return res.status(400).send("<h1>사용자를 찾을 수 없습니다</h1>");
    }

    user.emailVerified = true;
    await saveUsers(users);

    delete tokens[token];
    await saveEmailTokens(tokens);

    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #4caf50;">✓ 이메일 인증 완료!</h1>
          <p>이제 로그인하여 Kplace를 이용하실 수 있습니다.</p>
          <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #2196f3; color: white; text-decoration: none; border-radius: 4px;">홈으로 이동</a>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).send("<h1>이메일 인증에 실패했습니다</h1>");
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "이메일과 비밀번호를 입력해주세요" });
    }

    const users = await loadUsers();
    const user = users.find((u) => u.email === email);

    if (!user) {
      return res
        .status(401)
        .json({ error: "이메일 또는 비밀번호가 일치하지 않습니다" });
    }

    if (!skipEmail && !user.emailVerified) {
      return res
        .status(403)
        .json({ error: "이메일 인증이 필요합니다. 이메일을 확인해주세요." });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res
        .status(401)
        .json({ error: "이메일 또는 비밀번호가 일치하지 않습니다" });
    }

    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.username = user.username;

    res.json({
      message: "로그인 성공",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "로그인에 실패했습니다" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "로그아웃에 실패했습니다" });
    }
    res.json({ message: "로그아웃 성공" });
  });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }

  const users = await loadUsers();
  const user = users.find((entry) => entry.id === req.session.userId);
  const usage = getPixelWindowUsage(user);

  res.json({
    user: {
      id: req.session.userId,
      email: req.session.email,
      username: req.session.username,
      usedPixelsThisHour: usage.usedPixelsThisHour,
      remainingPixelsThisHour: usage.remainingPixelsThisHour,
      pixelLimitPerHour: usage.limitPerHour,
      pixelWindowStart: usage.windowStart,
      lastPixelPlacedAt: user?.lastPixelPlacedAt || null,
    },
  });
});

app.use(express.static("public"));

app.get("/api/osm-data", async (req, res) => {
  try {
    const osmData = await readFile(path.join(__dirname, "map.osm"), "utf-8");

    parseString(osmData, (err, result) => {
      if (err) {
        return res.status(500).json({ error: "파일 파싱 오류" });
      }
      res.json(result);
    });
  } catch (error) {
    res.status(500).json({ error: "파일 읽기 오류" });
  }
});

app.get("/api/selected-area", async (req, res) => {
  try {
    const areaData = await readFile(
      path.join(__dirname, "selected-area.json"),
      "utf-8",
    );
    res.json(JSON.parse(areaData));
  } catch (error) {
    res.status(404).json({ error: "선택된 영역 파일이 없습니다" });
  }
});

app.get("/api/grid-images/:cellId", async (req, res) => {
  try {
    const cellId = String(req.params.cellId || "");
    if (!/^[0-9]+-[0-9]+$/.test(cellId)) {
      return res.status(400).json({ error: "잘못된 cellId 형식" });
    }

    const imagePath = path.join(
      __dirname,
      "public",
      "grid-images",
      `${cellId}.png`,
    );

    try {
      await access(imagePath, fsConstants.F_OK);
      return res.sendFile(imagePath);
    } catch {
      res.setHeader("Content-Type", "image/png");
      return res.send(EMPTY_GRID_IMAGE_64);
    }
  } catch (error) {
    console.error("격자 이미지 조회 오류:", error);
    return res.status(500).json({ error: "격자 이미지 조회 실패" });
  }
});

app.post("/api/grid-images/save", requireAuth, async (req, res) => {
  try {
    const cellUpdates = Array.isArray(req.body?.cellUpdates)
      ? req.body.cellUpdates
      : null;

    if (!cellUpdates || cellUpdates.length === 0) {
      return res.status(400).json({ error: "저장할 변경사항이 없습니다" });
    }

    const requestedPixelCount = countValidPixelsForLimit(cellUpdates);
    if (requestedPixelCount === 0) {
      return res.status(400).json({ error: "유효한 변경사항이 없습니다" });
    }

    const users = await loadUsers();
    const user = users.find((entry) => entry.id === req.session.userId);

    if (!user) {
      return res.status(401).json({ error: "사용자 정보를 찾을 수 없습니다" });
    }

    const now = Date.now();
    const usage = getPixelWindowUsage(user, now);

    user.pixelCountWindowStart = usage.windowStart;
    user.pixelCountThisWindow = usage.usedPixelsThisHour;

    const currentCount = usage.usedPixelsThisHour;
    if (currentCount + requestedPixelCount > PIXEL_LIMIT_PER_HOUR) {
      const remaining = Math.max(0, PIXEL_LIMIT_PER_HOUR - currentCount);
      return res.status(429).json({
        error: `시간당 픽셀 제한(${PIXEL_LIMIT_PER_HOUR}개)을 초과했습니다. 남은 수량: ${remaining}`,
      });
    }

    const outputDir = path.join(__dirname, "public", "grid-images");
    await mkdir(outputDir, { recursive: true });

    let savedCount = 0;

    for (const update of cellUpdates) {
      const cellId = String(update?.cellId || "");
      const pixels = Array.isArray(update?.pixels) ? update.pixels : [];

      if (!/^[0-9]+-[0-9]+$/.test(cellId)) {
        continue;
      }

      if (pixels.length === 0) {
        continue;
      }

      const outputPath = path.join(outputDir, `${cellId}.png`);

      let rgba;
      let width = 64;
      let height = 64;

      try {
        const existingPng = await readFile(outputPath);
        const decoded = decodePng(existingPng);
        rgba = decoded.rgba;
        width = decoded.width;
        height = decoded.height;
      } catch {
        rgba = Buffer.alloc(width * height * 4, 0);
      }

      for (const pixel of pixels) {
        const x = parseInt(pixel.x);
        const y = parseInt(pixel.y);
        const color = pixel.color;

        if (
          isNaN(x) ||
          isNaN(y) ||
          x < 0 ||
          x >= width ||
          y < 0 ||
          y >= height ||
          typeof color !== "string"
        ) {
          continue;
        }

        const { r, g, b, a } = parseColor(color);
        const offset = (y * width + x) * 4;
        rgba[offset] = r;
        rgba[offset + 1] = g;
        rgba[offset + 2] = b;
        rgba[offset + 3] = a;
      }

      const pngBuffer = encodePngFromRgba(width, height, rgba);
      await writeFile(outputPath, pngBuffer);
      savedCount += 1;
    }

    if (savedCount === 0) {
      return res.status(400).json({ error: "유효한 변경사항이 없습니다" });
    }

    user.pixelCountThisWindow = currentCount + requestedPixelCount;
    user.lastPixelPlacedAt = new Date(now).toISOString();
    await saveUsers(users);

    res.json({
      savedCount,
      usedPixelsThisHour: user.pixelCountThisWindow,
      pixelLimitPerHour: PIXEL_LIMIT_PER_HOUR,
      remainingPixelsThisHour: Math.max(
        0,
        PIXEL_LIMIT_PER_HOUR - user.pixelCountThisWindow,
      ),
      lastPixelPlacedAt: user.lastPixelPlacedAt,
    });
  } catch (error) {
    console.error("격자 이미지 저장 오류:", error);
    res.status(500).json({ error: "격자 이미지 저장 실패" });
  }
});

function startServer(port, remainingRetries = 10) {
  const server = app.listen(port, () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다`);
  });

  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE" && remainingRetries > 0) {
      const nextPort = port + 1;
      console.warn(
        `포트 ${port} 가 사용 중입니다. 포트 ${nextPort} 로 재시도합니다.`,
      );
      startServer(nextPort, remainingRetries - 1);
      return;
    }

    console.error("서버 시작 실패:", error);
    process.exit(1);
  });
}

async function initializeAndStartServer() {
  if (!skipEmail) {
    await setupEmailTransporter();
  }
  startServer(BASE_PORT);
}

initializeAndStartServer();
