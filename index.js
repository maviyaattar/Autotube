import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import cloudinary from 'cloudinary'
import cron from 'node-cron'
import axios from 'axios'
import { google } from 'googleapis'
import { v4 as uuidv4 } from 'uuid'

const app = express()
app.use(cors({ origin: ['https://auto-tube-beta.vercel.app', 'http://localhost:3000'], credentials: true }))
app.use(express.json({ limit: '2mb' }))

// ====== Error Handler Middleware ======
app.use((err, req, res, next) => {
  console.error('[ERROR]', err)
  if (res.headersSent) return next(err)
  res.status(500).json({ msg: err.message || 'Internal server error' })
})

// ====== Cloudinary Config ======
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
})

// ====== Mongo Schemas ======
const ytAccountSchema = new mongoose.Schema({
  email: String,
  channelId: String,
  channelTitle: String,
  profileImg: String,
  refresh_token: String,
}, { _id: false })

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  ytAccounts: [ytAccountSchema],
  selectedAccount: Number,
  preferences: {
    niche: String,
    theme: String,
    uploadCount: Number,
    uploadTimes: [String]
  }
})
const User = mongoose.model('User', userSchema)

const jobSchema = new mongoose.Schema({
  userId: mongoose.Types.ObjectId,
  ytAccountIdx: Number,
  quote: String,
  topic: String,
  theme: String,
  videoUrl: String,
  thumbUrl: String,
  uploadedAt: Date,
  youtubeId: String,
  status: { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
  error: String
})
const Job = mongoose.model('Job', jobSchema)

// ====== Auth Middleware ======
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '')
    if (!token) throw new Error('No token')
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = await User.findById(decoded.id)
    if (!req.user) throw new Error('Not found')
    next()
  } catch (e) {
    res.status(401).json({ msg: e.message || 'Unauthorized' })
  }
}

// ====== Themes, Niches, Quotes ======
const THEMES = ["Classic", "Neon", "Rustic"]
const NICHES = ["Islamic", "Motivation", "Funny", "Jokes", "Riddles"]
function generateQuote(topic = "Life") {
  const demos = {
    Motivation: ["Never give up on your dreams.", "Dream big, work hard.", "Success is no accident."],
    Islamic: ["Trust in Allah, He is the best Planner.", "Prayer changes everything."],
    Jokes: ["Why did the chicken cross the road?", "Why do programmers prefer dark mode?"],
    Riddles: ["What gets wetter as it dries?", "I speak without a mouth and hear without ears. What am I?"],
    Funny: ["I'm reading a book on anti-gravity. It's impossible to put down!"]
  }
  const arr = demos[topic] || Object.values(demos).flat()
  return arr[Math.floor(Math.random()*arr.length)]
}

// ====== Cloudinary Sample Video/Text Overlay ======
async function generateVideoAndThumb({ quote, theme }) {
  const color = theme === "Neon" ? "#F9F871" : theme === "Rustic" ? "#3B260A" : "#121212"
  const text = encodeURIComponent(quote.slice(0,70))
  const videoUrl = cloudinary.v2.url("sample", {
    resource_type: "video",
    width: 1080, height: 1920,
    crop: "fill", gravity: "auto",
    overlay: [{
      font_family: "Arial",
      font_size: 60,
      font_weight: "bold",
      text: text,
      color: color.replace("#", "rgb:"),
      y: 0,
      gravity: "center"
    }],
    flags: "layer_apply"
  })
  const thumbUrl = cloudinary.v2.url("sample", {
    resource_type: "image",
    width: 1080, height: 1920,
    crop: "fill", gravity: "auto",
    overlay: [{
      font_family: "Arial",
      font_size: 80,
      font_weight: "bold",
      text: text,
      color: color.replace("#", "rgb:"),
      y: 0,
      gravity: "center"
    }],
    flags: "layer_apply"
  })
  return { videoUrl, thumbUrl }
}

// ====== YouTube OAuth2 Helpers ======
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.YT_OAUTH_REDIRECT
  )
}

// ====== API Endpoints ======

// Health
app.get("/", (req, res) => res.send('YT SaaS Backend live!'))

// Signup
app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body
    if (!name || !email || !password) return res.status(400).send({ msg: "All fields required" })
    if (await User.findOne({ email })) return res.status(400).send({ msg: "Email exists" })
    const hash = await bcrypt.hash(password, 12)
    const user = await User.create({ name, email, password: hash, ytAccounts: [] })
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET)
    res.json({ token, user: { name, email } })
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body
    const user = await User.findOne({ email })
    if (!user) return res.status(400).send({ msg: "No user" })
    if (!await bcrypt.compare(password, user.password))
      return res.status(400).send({ msg: "Wrong password" })
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET)
    res.json({ token, user: { name: user.name, email: user.email } })
  } catch (err) {
    res.status(500).json({ msg: err.message })
  }
})

// User dashboard info
app.get('/api/me', auth, (req, res) => {
  try {
    const u = req.user
    res.json({ user: {
      name: u.name,
      email: u.email,
      ytAccounts: u.ytAccounts,
      selectedAccount: u.selectedAccount,
      preferences: u.preferences
    }})
  } catch (e) { res.status(500).json({ msg: e.message }) }
})

// Get themes/niches for setup
app.get("/api/templates", (req, res) => {
  res.json({ themes: THEMES, niches: NICHES })
})

// Set preferences
app.post('/api/preferences', auth, async (req, res) => {
  try {
    req.user.preferences = req.body
    await req.user.save()
    res.json({ preferences: req.user.preferences })
  } catch (e) { res.status(500).json({ msg: e.message }) }
})

// === YouTube Connect ===
app.get("/api/youtube/connect", auth, (req, res) => {
  try {
    const client = getOAuth2Client()
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ]
    })
    res.json({ url })
  } catch (e) { res.status(500).json({ msg: e.message }) }
})
// Callback: exchange code for tokens (code comes from frontend)
app.post("/api/youtube/callback", auth, async (req, res) => {
  const { code } = req.body
  const client = getOAuth2Client()
  try {
    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: "v2", auth: client })
    const resp = await oauth2.userinfo.get()
    const youtube = google.youtube({ version: "v3", auth: client })
    const channelList = await youtube.channels.list({ mine: true, part: ["snippet"] })
    const channelInfo = channelList.data.items && channelList.data.items[0]
    if (!channelInfo) throw new Error("YouTube channel not found!")
    req.user.ytAccounts.push({
      email: resp.data.email,
      channelId: channelInfo.id,
      channelTitle: channelInfo.snippet.title,
      profileImg: channelInfo.snippet.thumbnails.default.url,
      refresh_token: tokens.refresh_token
    })
    req.user.selectedAccount = req.user.ytAccounts.length - 1
    await req.user.save()
    res.json({ ytAccount: req.user.ytAccounts[req.user.selectedAccount] })
  } catch (err) {
    res.status(400).json({ msg: "OAuth failed: " + err.message })
  }
})
// Switch YouTube account
app.post("/api/youtube/switch", auth, async (req, res) => {
  const { idx } = req.body
  try {
    if (idx == null || idx < 0 || idx >= req.user.ytAccounts.length)
      return res.status(400).json({ msg: "Invalid account index" })
    req.user.selectedAccount = idx
    await req.user.save()
    res.json({ selected: idx })
  } catch (e) { res.status(500).json({ msg: e.message }) }
})
// Disconnect account
app.post("/api/youtube/disconnect", auth, async (req, res) => {
  const { idx } = req.body
  try {
    if (idx == null || idx < 0 || idx >= req.user.ytAccounts.length)
      return res.status(400).json({ msg: "Invalid account index" })
    req.user.ytAccounts.splice(idx, 1)
    req.user.selectedAccount = req.user.selectedAccount >= req.user.ytAccounts.length ? 0 : req.user.selectedAccount
    await req.user.save()
    res.json({ accounts: req.user.ytAccounts, selected: req.user.selectedAccount })
  } catch (e) { res.status(500).json({ msg: e.message }) }
})

// Schedule Shorts
app.post('/api/schedule', auth, async (req, res) => {
  const { preferences, selectedAccount, ytAccounts } = req.user
  try {
    if (!ytAccounts || ytAccounts.length === 0)
      return res.status(400).json({ msg: "No YouTube account linked" })
    if (!preferences || !preferences.theme || !preferences.niche)
      return res.status(400).json({ msg: "Set preferences first" })
    const jobs = []
    const upTimes = preferences.uploadTimes || ['12:00']
    for (let t of upTimes) {
      jobs.push(await Job.create({
        userId: req.user._id,
        ytAccountIdx: selectedAccount || 0,
        quote: generateQuote(preferences.niche),
        topic: preferences.niche,
        theme: preferences.theme,
        status: "pending"
      }))
    }
    res.json({ jobs, msg: `Scheduled ${jobs.length} Shorts for today!` })
  } catch (e) { res.status(500).json({ msg: e.message }) }
})

// Dashboard shorts for user
app.get('/api/my-shorts', auth, async (req, res) => {
  try {
    const jobs = await Job.find({ userId: req.user._id }).sort('-uploadedAt').limit(25)
    res.json({ shorts: jobs })
  } catch (e) { res.status(500).json({ msg: e.message }) }
})

// === Worker logic: process jobs & upload to YouTube ===
async function workerProcess() {
  const pending = await Job.find({ status: 'pending' }).limit(10)
  for (let job of pending) {
    try {
      job.status = 'processing'; await job.save()
      // Find user, preferences, YT account
      const user = await User.findById(job.userId)
      if (!user || !user.ytAccounts.length) throw new Error("YT account gone")
      const yt = user.ytAccounts[job.ytAccountIdx || 0]
      if (!yt) throw new Error("YT account not found")
      // Generate video/thumbnails (put your real worker logic here!)
      const { videoUrl, thumbUrl } = await generateVideoAndThumb({
        quote: job.quote || generateQuote(job.topic),
        theme: job.theme || "Classic"
      })
      // Upload to YouTube
      const oauth2Client = getOAuth2Client()
      oauth2Client.setCredentials({ refresh_token: yt.refresh_token })
      const youtube = google.youtube({ version: "v3", auth: oauth2Client })
      const vReq = await axios.get(videoUrl, { responseType: "stream" })
      const tmpPath = `/tmp/${uuidv4()}.mp4`
      const writer = require('fs').createWriteStream(tmpPath)
      await new Promise((resolve, reject) => {
        vReq.data.pipe(writer)
        writer.on('finish', resolve)
        writer.on('error', reject)
      })
      const meta = {
        title: `${job.quote} | Shorts`,
        description: `${job.quote}\n\nAuto-uploaded by AutoTube SaaS.`,
        tags: ["Shorts", job.topic, "Motivation", "Islamic", "Quotes"],
        categoryId: "22",
      }
      const ytRes = await youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: { ...meta },
          status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
        },
        media: { body: require('fs').createReadStream(tmpPath) }
      })
      job.status = "done"
      job.videoUrl = videoUrl
      job.thumbUrl = thumbUrl
      job.youtubeId = ytRes.data.id
      job.uploadedAt = new Date()
      job.error = null
      await job.save()
      require('fs').unlinkSync(tmpPath)
      console.log(`[WORKER] Uploaded: ${meta.title}`)
    } catch (err) {
      job.status = "failed"
      job.error = err.message || "Job failed"
      await job.save()
      console.error("[WORKER] Failed:", err.message)
    }
  }
}
app.post('/api/worker-run', async (req, res) => {
  await workerProcess();
  res.json({ msg: "Worker process run finished!" });
})
cron.schedule("0 * * * *", workerProcess);

// ========== SERVER START ==========
const PORT = process.env.PORT || 4000
mongoose.connect(process.env.MONGO_URI, { })
  .then(() => app.listen(PORT, () => console.log(`YT SaaS backend on ${PORT}`)))
  .catch(e => console.error(e))
