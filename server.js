const express = require("express");
const path = require("path");
require("dotenv").config();

const OpenAI = require("openai");

const app = express();

const PORT =
Number(process.env.PORT) || 3000;

const MODEL =
process.env.OPENAI_MODEL ||
"gpt-5.6-luna";

const apiKey =
process.env.OPENAI_API_KEY;

if(
!apiKey &&
process.env.VERCEL !== "1"
){

console.error(
"OPENAI_API_KEY belum ditemukan."
);

process.exit(1);

}

const openai =
new OpenAI({

apiKey:
apiKey ||
"missing-key"

});

const POWER_AI_INSTRUCTIONS = [
"Kamu adalah Power AI.",
"Gunakan bahasa Indonesia secara default kecuali pengguna meminta bahasa lain.",
"Jawab secara akurat, jelas, langsung, dan membantu.",
"Jangan mengarang fakta, sumber, kemampuan, atau memory.",
"Jika pengguna meminta kode lengkap, berikan kode lengkap yang siap dipakai.",
"Bantu programming, HTML, CSS, JavaScript, Node.js, Express, Python, C, C++, ESP32, Arduino, IoT, debugging, website, dan teknologi.",
"Perhatikan seluruh percakapan yang diberikan sebagai konteks.",
"Gunakan Global Memory hanya sebagai informasi tambahan tentang pengguna.",
"Jika Web Search aktif, gunakan pencarian web bila diperlukan.",
"Jika terjadi error, analisis penyebab dan berikan solusi konkret.",
"Jangan mengatakan kamu melakukan sesuatu jika sebenarnya tidak melakukannya.",
"Nama kamu adalah Power AI."
].join("\n");

app.use(
express.json({
limit:
"25mb"
})
);

app.use(
express.urlencoded({
extended:
true,
limit:
"25mb"
})
);

app.use(
express.static(
__dirname
)
);

app.use(
function(
req,
res,
next
){

res.setHeader(
"X-Content-Type-Options",
"nosniff"
);

res.setHeader(
"X-Frame-Options",
"SAMEORIGIN"
);

res.setHeader(
"Referrer-Policy",
"strict-origin-when-cross-origin"
);

res.setHeader(
"Permissions-Policy",
"microphone=(self)"
);

next();

}
);

function cleanMessages(
messages
){

if(
!Array.isArray(
messages
)
){

return [];

}

return messages
.filter(
function(message){

return (
message &&
(
message.role ===
"user" ||
message.role ===
"assistant"
) &&
typeof message.content ===
"string" &&
message.content.trim()
);

}
)
.map(
function(message){

return {

role:
message.role,

content:
message.content
.trim()
.slice(
0,
50000
)

};

}
);

}

function cleanMemory(
memory
){

if(
!memory ||
typeof memory !==
"object"
){

return {
name:"",
facts:[]
};

}

return {

name:
typeof memory.name ===
"string"
?memory.name
.trim()
.slice(0,100)
:"",

facts:
Array.isArray(
memory.facts
)
?memory.facts
.filter(
function(item){

return (
typeof item ===
"string" &&
item.trim()
);

}
)
.map(
function(item){

return item
.trim()
.slice(0,500);

}
)
.slice(
0,
50
)
:[]

};

}

function buildMemoryText(
memory
){

const clean =
cleanMemory(
memory
);

const parts=[];

if(
clean.name
){

parts.push(
"Nama pengguna: "+
clean.name
);

}

if(
clean.facts.length
){

parts.push(
"Fakta yang disimpan:\n- "+
clean.facts.join(
"\n- "
)
);

}

if(
!parts.length
){

return:
"Belum ada Global Memory.";

}

return parts.join(
"\n"
);

}

function updateExplicitMemory(
memory,
messages
){

const result={

memory:
cleanMemory(
memory
),

changed:
false,

action:
""

};

const lastUser=
messages
.slice()
.reverse()
.find(
function(message){

return (
message.role===
"user"
);

}
);

if(!lastUser){

return result;

}

const text=
lastUser.content
.trim();

const lower=
text.toLowerCase();

const nameMatch=
text.match(
/^(?:nama saya|namaku|panggil saya|panggil aku)\s+(.+)$/i
);

if(nameMatch){

const name=
nameMatch[1]
.replace(
/[.!?]+$/,
""
)
.trim()
.slice(
0,
100
);

if(name){

result.memory.name=
name;

result.changed=
true;

result.action=
"Nama disimpan.";

}

}

const rememberMatch=
text.match(
/^(?:ingat bahwa|ingat|catat bahwa|catat|simpan bahwa|simpan)\s+(.+)$/i
);

if(
rememberMatch &&
!lower.startsWith(
"ingat siapa"
)
){

const fact=
rememberMatch[1]
.replace(
/[.!?]+$/,
""
)
.trim()
.slice(
0,
500
);

if(fact){

const exists=
result.memory.facts.some(
function(item){

return (
item.toLowerCase()===
fact.toLowerCase()
);

}
);

if(!exists){

result.memory.facts.push(
fact
);

result.memory.facts=
result.memory.facts.slice(
-50
);

result.changed=
true;

result.action=
"Memory baru disimpan.";

}

}

}

const forgetMatch=
text.match(
/^(?:lupakan|hapus memory|hapus ingatan)\s+(.+)$/i
);

if(forgetMatch){

const target=
forgetMatch[1]
.replace(
/[.!?]+$/,
""
)
.trim()
.toLowerCase();

if(target){

const oldFacts=
result.memory.facts.length;

result.memory.facts=
result.memory.facts.filter(
function(item){

return (
!item
.toLowerCase()
.includes(
target
) &&
!target.includes(
item.toLowerCase()
)
);

}
);

if(
result.memory.name &&
result.memory.name
.toLowerCase()
.includes(
target
)
){

result.memory.name=
"";

}

if(
oldFacts !==
result.memory.facts.length
||
!result.memory.name
){

result.changed=
true;

result.action=
"Memory dihapus.";

}

}

}

return result;

}

function buildSmartContext(
messages,
maxChars
){

if(
!messages.length
){

return [];

}

const total=
messages.reduce(
function(
sum,
message
){

return (
sum+
message.content.length
);

},
0
);

if(
total<=maxChars
){

return messages;

}

const selected=[];
const used=
new Set();

const firstCount=
Math.min(
4,
messages.length
);

for(
let i=0;
i<firstCount;
i++
){

selected.push(
messages[i]
);

used.add(
i
);

}

let chars=
selected.reduce(
function(
sum,
message
){

return (
sum+
message.content.length
);

},
0
);

for(
let i=
messages.length-1;
i>=0;
i--
){

if(
used.has(i)
){

continue;

}

const size=
messages[i]
.content.length;

if(
chars+
size>
maxChars
){

continue;

}

selected.push(
messages[i]
);

used.add(i);

chars+=
size;

if(
chars>=
maxChars*.95
){

break;

}

}

selected.sort(
function(
a,
b
){

return (
messages.indexOf(a)-
messages.indexOf(b)
);

}
);

return selected;

}

function getErrorMessage(
error
){

const status=
Number(
error &&
error.status
);

if(
status===400
){

return:
"Request tidak valid. Periksa data yang dikirim.";

}

if(
status===401
){

return:
"API key OpenAI tidak valid atau belum dikonfigurasi.";

}

if(
status===403
){

return:
"Akses API ditolak. Periksa project, permission, atau API key.";

}

if(
status===404
){

return:
"Model atau resource tidak ditemukan. Periksa OPENAI_MODEL.";

}

if(
status===408
){

return:
"Request terlalu lama. Silakan coba lagi.";

}

if(
status===429
){

return:
"API terkena rate limit atau kredit API habis.";

}

if(
status>=500
){

return:
"Server OpenAI sedang mengalami masalah. Silakan coba lagi.";

}

if(
error &&
typeof error.message===
"string" &&
error.message.trim()
){

return:
error.message;

}

return:
"Power AI mengalami kesalahan.";

}

async function createAIResponse(
options
){

const messages=
cleanMessages(
options.messages
);

const memory=
cleanMemory(
options.memory
);

const contextMessages=
buildSmartContext(
messages,
220000
);

const request={

model:
MODEL,

instructions:
[
POWER_AI_INSTRUCTIONS,
"",
"GLOBAL MEMORY:",
buildMemoryText(memory),
"",
"SMART CONTEXT:",
"Gunakan percakapan berikut sebagai konteks.",
"Jika informasi lama tidak relevan, jangan dipaksakan."
].join("\n"),

input:
contextMessages,

max_output_tokens:
12000

};

if(
options.webSearch===
true
){

request.tools=[
{
type:
"web_search"
}
];

}

return openai.responses.create(
request
);

}

app.post(
"/chat",
async function(
req,
res
){

const started=
Date.now();

try{

if(
!apiKey
){

return res
.status(
500
)
.json({

success:
false,

error:
"OPENAI_API_KEY belum tersedia."

});

}

const messages=
cleanMessages(
req.body.messages
);

if(
!messages.length
){

return res
.status(
400
)
.json({

success:
false,

error:
"Pesan kosong."

});

}

const memoryResult=
updateExplicitMemory(
req.body.memory,
messages
);

const webSearch=
req.body.webSearch===
true;

const response=
await createAIResponse({

messages:
messages,

memory:
memoryResult.memory,

webSearch:
webSearch

});

const reply=
typeof response.output_text===
"string" &&
response.output_text.trim()
?response.output_text.trim()
:"Power AI tidak mendapatkan jawaban.";

return res.json({

success:
true,

reply:
reply,

model:
MODEL,

webSearch:
webSearch,

memory:
memoryResult.memory,

memoryUpdated:
memoryResult.changed,

memoryAction:
memoryResult.action,

duration:
Date.now()-started

});

}catch(error){

console.error(
"CHAT ERROR:",
error
);

const status=
Number(
error &&
error.status
);

return res
.status(
status>=400 &&
status<600
?status
:500
)
.json({

success:
false,

error:
getErrorMessage(
error
)

});

}

}
);

app.post(
"/generate-image",
async function(
req,
res
){

try{

if(
!apiKey
){

return res
.status(
500
)
.json({

success:
false,

error:
"OPENAI_API_KEY belum tersedia."

});

}

const prompt=
typeof req.body.prompt===
"string"
?req.body.prompt
.trim()
.slice(
0,
10000
)
:"";

if(!prompt){

return res
.status(
400
)
.json({

success:
false,

error:
"Prompt gambar kosong."

});

}

const response=
await openai.responses.create({

model:
MODEL,

input:
"Buat gambar berdasarkan prompt berikut:\n\n"+
prompt,

tools:[
{
type:
"image_generation"
}
]

});

const output=
Array.isArray(
response.output
)
?response.output
:[];

const imageCall=
output.find(
function(item){

return (
item &&
item.type===
"image_generation_call"
);

}
);

if(
!imageCall||
!imageCall.result
){

return res
.status(
500
)
.json({

success:
false,

error:
"AI tidak menghasilkan gambar."

});

}

return res.json({

success:
true,

image:
"data:image/png;base64,"+
imageCall.result,

prompt:
prompt

});

}catch(error){

console.error(
"IMAGE ERROR:",
error
);

const status=
Number(
error &&
error.status
);

return res
.status(
status>=400 &&
status<600
?status
:500
)
.json({

success:
false,

error:
getErrorMessage(
error
)

});

}

}
);

app.get(
"/status",
function(
req,
res
){

return res.json({

success:
true,

name:
"Power AI",

model:
MODEL,

status:
"online",

features:{

chat:
true,

conversationContext:
true,

globalMemory:
true,

webSearch:
true,

imageGeneration:
true,

voiceInput:
true,

history:
true

}

});

}
);

app.get(
"/health",
function(
req,
res
){

return res
.status(
200
)
.json({

success:
true,

status:
"online"

});

}
);

app.get(
"/",
function(
req,
res
){

return res.sendFile(
path.join(
__dirname,
"index.html"
)
);

}
);

app.use(
function(
req,
res
){

if(
req.path===
"/chat"||
req.path.startsWith(
"/chat/"
)||
req.path===
"/generate-image"||
req.path.startsWith(
"/generate-image/"
)||
req.path===
"/status"||
req.path.startsWith(
"/status/"
)||
req.path===
"/health"||
req.path.startsWith(
"/health/"
)
){

return res
.status(
404
)
.json({

success:
false,

error:
"Endpoint tidak ditemukan."

});

}

return res
.status(
404
)
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
){

console.error(
"SERVER ERROR:",
error
);

if(
res.headersSent
){

return next(
error
);

}

return res
.status(
500
)
.json({

success:
false,

error:
"Terjadi kesalahan pada server Power AI."

});

}
);

module.exports =
app;

if(
process.env.VERCEL!==
"1"
){

app.listen(
PORT,
"0.0.0.0",
function(){

console.log("");
console.log(
"===================================="
);
console.log(
"POWER AI SUPER SERVER"
);
console.log(
"===================================="
);
console.log(
"Server: http://localhost:"+
PORT
);
console.log(
"Model: "+
MODEL
);
console.log(
"Memory: ACTIVE"
);
console.log(
"Smart Context: ACTIVE"
);
console.log(
"Web Search: ACTIVE"
);
console.log(
"Image Generation: ACTIVE"
);
console.log(
"===================================="
);

}
);
