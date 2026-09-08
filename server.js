const express = require("express");
const path = require("path");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error("OPENAI_API_KEY belum ditemukan di file .env");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: apiKey });

const POWER_AI_INSTRUCTIONS = [
  "Nama kamu adalah Power AI.",
  "Gunakan bahasa Indonesia secara default dan ikuti bahasa pengguna jika berbeda.",
  "Kamu adalah AI Assistant untuk pertanyaan umum, coding, debugging, HTML, CSS, JavaScript, Node.js, Express, Python, C, C++, Arduino, ESP32, IoT, website, API, database, dan pekerjaan digital.",
  "Jawab dengan jelas, akurat, praktis, dan jujur.",
  "Jangan mengarang fakta, hasil web search, isi file, atau memory.",
  "Gunakan seluruh percakapan yang diberikan sebagai konteks.",
  "Jika pengguna meminta FULL CODE, FULL SCRIPT, INDEX FULL, atau SERVER FULL, berikan satu file lengkap yang siap dicopy-paste.",
  "Saat debugging, identifikasi penyebab, jelaskan penyebabnya, lalu berikan perbaikan yang konkret.",
  "Untuk ESP32 dan Arduino, perhatikan pin, wiring, library, WiFi, HTTP, GPIO, PWM, sensor, motor, dan Serial Monitor.",
  "Jangan meminta atau menampilkan API key, password, token, private key, atau secret.",
  "Jika web search aktif, gunakan informasi terbaru dan prioritaskan sumber yang tepercaya."
].join("\n");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(__dirname));

app.use(function(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "microphone=(self)");
  next();
});

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(function(message) {
      return !!message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0;
    })
    .map(function(message) {
      return {
        role: message.role,
        content: message.content.trim().slice(0, 50000)
      };
    });
}

function cleanMemory(memory) {
  if (!memory || typeof memory !== "object") {
    return {
      name: "",
      facts: []
    };
  }

  return {
    name:
      typeof memory.name === "string"
        ? memory.name.trim().slice(0, 100)
        : "",

    facts:
      Array.isArray(memory.facts)
        ? memory.facts
            .filter(function(item) {
              return (
                typeof item === "string" &&
                item.trim().length > 0
              );
            })
            .map(function(item) {
              return item.trim().slice(0, 500);
            })
            .slice(0, 50)
        : []
  };
}

function buildMemoryText(memory) {
  const clean = cleanMemory(memory);
  const parts = [];

  if (clean.name) {
    parts.push(
      "Nama pengguna: " +
      clean.name
    );
  }

  clean.facts.forEach(function(fact) {
    parts.push(
      "- " +
      fact
    );
  });

  if (!parts.length) {
    return "Tidak ada Global Memory.";
  }

  return parts.join("\n");
}

function detectMemory(memory, latestUserText) {
  const result = cleanMemory(memory);
  const text = String(
    latestUserText || ""
  ).trim();

  const nameMatch =
    text.match(
      /^(?:nama saya|namaku|panggil saya|panggil aku)\s+(.+)$/i
    );

  if (nameMatch) {
    const name =
      nameMatch[1]
        .replace(/[.!?]+$/, "")
        .trim()
        .slice(0, 100);

    if (name) {
      result.name = name;
    }
  }

  const rememberMatch =
    text.match(
      /^(?:ingat bahwa|ingat|catat bahwa|catat|simpan bahwa|simpan)\s+(.+)$/i
    );

  if (rememberMatch) {
    const fact =
      rememberMatch[1]
        .replace(/[.!?]+$/, "")
        .trim()
        .slice(0, 500);

    if (fact) {
      const exists =
        result.facts.some(function(item) {
          return (
            item.toLowerCase() ===
            fact.toLowerCase()
          );
        });

      if (!exists) {
        result.facts.push(fact);
      }

      result.facts =
        result.facts.slice(-50);
    }
  }

  const forgetMatch =
    text.match(
      /^(?:lupakan|hapus memory|hapus ingatan)\s+(.+)$/i
    );

  if (forgetMatch) {
    const target =
      forgetMatch[1]
        .replace(/[.!?]+$/, "")
        .trim()
        .toLowerCase();

    result.facts =
      result.facts.filter(function(item) {
        return (
          !item.toLowerCase().includes(target) &&
          !target.includes(
            item.toLowerCase()
          )
        );
      });

    if (
      result.name &&
      result.name.toLowerCase().includes(target)
    ) {
      result.name = "";
    }
  }

  return result;
}

function getErrorMessage(error) {
  const status =
    Number(
      error &&
      error.status
    );

  if (status === 401) {
    return (
      "API key OpenAI tidak valid atau belum dikonfigurasi."
    );
  }

  if (status === 403) {
    return (
      "Akses API ditolak. Periksa permission dan project API."
    );
  }

  if (status === 404) {
    return (
      "Model atau endpoint tidak ditemukan. Periksa model di .env."
    );
  }

  if (status === 408) {
    return (
      "Request timeout. Silakan coba lagi."
    );
  }

  if (status === 429) {
    return (
      "API terkena rate limit atau kredit API belum tersedia."
    );
  }

  if (status >= 500) {
    return (
      "Server AI mengalami gangguan. Silakan coba lagi."
    );
  }

  if (
    error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }

  return (
    "Terjadi kesalahan pada server Power AI."
  );
}

async function makeChatResponse(
  messages,
  memory,
  webSearch
) {
  const clean =
    cleanMessages(messages);

  const limited =
    clean.slice(-80);

  const memoryText =
    buildMemoryText(memory);

  const instructions =
    POWER_AI_INSTRUCTIONS +
    "\n\nGLOBAL USER MEMORY:\n" +
    memoryText +
    "\n\nGunakan Global Memory hanya jika relevan.";

  const options = {
    model: MODEL,
    instructions: instructions,
    input: limited,
    max_output_tokens: 12000
  };

  if (webSearch) {
    options.tools = [
      {
        type: "web_search"
      }
    ];
  }

  return openai.responses.create(
    options
  );
}

app.post(
  "/chat",
  async function(req, res) {
    try {
      const messages =
        cleanMessages(
          req.body &&
          req.body.messages
        );

      const oldMemory =
        cleanMemory(
          req.body &&
          req.body.memory
        );

      const webSearch =
        req.body &&
        req.body.webSearch === true;

      if (!messages.length) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Pesan kosong."
          });
      }

      const latestUser =
        messages
          .slice()
          .reverse()
          .find(function(item) {
            return (
              item.role === "user"
            );
          });

      const memory =
        detectMemory(
          oldMemory,
          latestUser
            ? latestUser.content
            : ""
        );

      const response =
        await makeChatResponse(
          messages,
          memory,
          webSearch
        );

      const reply =
        typeof response.output_text === "string"
          ? response.output_text.trim()
          : "Power AI tidak mendapatkan jawaban.";

      res.json({
        success: true,
        reply:
          reply ||
          "Power AI tidak mendapatkan jawaban.",
        model: MODEL,
        webSearch: webSearch,
        memory: memory
      });

    } catch (error) {
      console.error(
        "POWER AI CHAT ERROR:",
        error
      );

      const status =
        Number(error && error.status);

      res
        .status(
          Number.isInteger(status) &&
          status >= 400 &&
          status < 600
            ? status
            : 500
        )
        .json({
          success: false,
          error:
            getErrorMessage(error)
        });
    }
  }
);

app.post(
  "/generate-image",
  async function(req, res) {
    try {
      const prompt =
        typeof req.body?.prompt === "string"
          ? req.body.prompt
              .trim()
              .slice(0, 10000)
          : "";

      if (!prompt) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Prompt gambar kosong."
          });
      }

      const imageResponse =
        await openai.images.generate({
          model: "gpt-image-2",
          prompt: prompt,
          size: "1024x1024",
          quality: "auto",
          n: 1
        });

      const imageData =
        imageResponse &&
        Array.isArray(
          imageResponse.data
        ) &&
        imageResponse.data[0] &&
        imageResponse.data[0].b64_json
          ? imageResponse.data[0].b64_json
          : "";

      if (!imageData) {
        return res
          .status(500)
          .json({
            success: false,
            error:
              "Image Generator tidak menghasilkan gambar."
          });
      }

      res.json({
        success: true,
        image:
          "data:image/png;base64," +
          imageData,
        prompt: prompt
      });

    } catch (error) {
      console.error(
        "POWER AI IMAGE ERROR:",
        error
      );

      const status =
        Number(error && error.status);

      res
        .status(
          Number.isInteger(status) &&
          status >= 400 &&
          status < 600
            ? status
            : 500
        )
        .json({
          success: false,
          error:
            getErrorMessage(error)
        });
    }
  }
);

app.get(
  "/status",
  function(req, res) {
    res.json({
      success: true,
      name: "Power AI",
      model: MODEL,
      status: "online",
      features: {
        chat: true,
        history: true,
        globalMemory: true,
        regenerate: true,
        webSearch: true,
        imageGenerator: true,
        voiceInput: true,
        textToSpeech: true
      }
    });
  }
);

app.get(
  "/health",
  function(req, res) {
    res.json({
      success: true,
      status: "online",
      model: MODEL
    });
  }
);

app.get(
  "/",
  function(req, res) {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

app.use(
  function(req, res) {
    if (
      req.path === "/chat" ||
      req.path.startsWith("/chat/") ||
      req.path === "/generate-image" ||
      req.path.startsWith("/generate-image/") ||
      req.path === "/status" ||
      req.path === "/health"
    ) {
      return res
        .status(404)
        .json({
          success: false,
          error:
            "Endpoint tidak ditemukan."
        });
    }

    res
      .status(404)
      .send(
        "Halaman tidak ditemukan."
      );
  }
);

app.use(
  function(
    error,
    req,
    res,
    next
  ) {
    console.error(
      "POWER AI GLOBAL ERROR:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res
      .status(500)
      .json({
        success: false,
        error:
          "Terjadi kesalahan server Power AI."
      });
  }
);

app.listen(
  PORT,
  function() {
    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "              POWER AI SUPER"
    );
    console.log(
      "=========================================="
    );
    console.log(
      "Server : http://localhost:" +
      PORT
    );
    console.log(
      "Model  : " +
      MODEL
    );
    console.log(
      "Status : ONLINE"
    );
    console.log(
      "=========================================="
    );
    console.log("");
  }
);