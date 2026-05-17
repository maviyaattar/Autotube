import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import cloudinary from 'cloudinary'
import cron from 'node-cron'
import axios from 'axios'

const app = express()
app.use(cors())
app.use(express.json())

// ===== DB Schemas =====
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String, // Use bcrypt in prod!
  name: String,
  ytAccounts: [{
    refresh_token: String,
    channelTitle: String
  }],
  preferences: {
    niche: String,
    theme: String,
    uploadCount: Number,
    uploadTimes: [String]
  }
})
const User = mongoose.model('User', userSchema)

const shortSchema = new mongoose.Schema({
  userId: mongoose.Types.ObjectId,
  quote: String,
  topic: String,
  theme: String,
  videoUrl: String,
  thumbUrl: String,
  uploadedAt: Date,
  status: String
})
const Short = mongoose.model('Short', shortSchema)

// ==== AUTH Helper ====
const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ msg: 'No token' })
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = await User.findById(decoded.id)
    if (!req.user) throw new Error('Not found')
    next()
  } catch {
    res.status(401).json({ msg: 'Invalid/expired token' })
  }
}

// === Cloudinary ===
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
})

// === Util: get backgrounds & theme overlays ===
const THEMES = {
  Classic: {
    bg: "https://res.cloudinary.com/demo/image/upload/v1700000000/bg-classic.jpg",
    borderColor: "#FABC2A",
    fontColor: "#121212"
  },
  Neon: {
    bg: "https://res.cloudinary.com/demo/image/upload/v1700000000/bg-neon.jpg",
    borderColor: "#22AADD",
    fontColor: "#F9F871"
  },
  Rustic: {
    bg: "https://res.cloudinary.com/demo/image/upload/v1700000000/bg-rustic.jpg",
    borderColor: "#A86B4C",
    fontColor: "#3B260A"
  }
  // ...add as many as you want!
}

// === Dummy Quote Generator (replace with real AI/Groq/OpenAI later) ===
function generateQuote(topic = "Life") {
  const demos = {
    Motivation: ["Never give up on your dreams.", "The only limit is your mind."],
    Islamic: ["Trust in Allah, He is the best Planner.", "Prayer changes everything."]
  }
  let arr = demos[topic] || demos.Motivation
  return arr[Math.floor(Math.random()*arr.length)]
}

// == Util: Generate Video & Thumb (Cloudinary URL manip) ==
async function generateVideoAndThumb({ quote, theme }) {
  // Use Cloudinary overlays by URL (no ffmpeg required)
  const t = THEMES[theme] || THEMES['Classic']
  // Video BG: could be mp4 or image url. We'll use "l_text" overlays for styling.
  const text = encodeURIComponent(quote)
  const videoUrl = cloudinary.v2.url("sample", {
    resource_type: "video",
    width: 1080, height: 1920, crop: "fill", gravity: "auto",
    overlay: [
      {
        font_family: "Arial",
        font_size: 60,
        font_weight: "bold",
        text: text,
        color: t.fontColor.replace("#", "rgb:"),
        y: 0,
        gravity: "center",
        border: `10px_solid_${t.borderColor.replace("#", "rgb:")}`
      }
    ],
    background: t.bg,
    flags: "layer_apply"
  })
  // Thumb as static image with same overlay
  const thumbUrl = cloudinary.v2.url("sample", {
    resource_type: "image",
    width: 1080, height: 1920, crop: "fill", gravity: "auto",
    overlay: [
      {
        font_family: "Arial",
        font_size: 80,
        font_weight: "bold",
        text: text,
        color: t.fontColor.replace("#", "rgb:"),
        y: 0,
        gravity: "center",
        border: `10px_solid_${t.borderColor.replace("#", "rgb:")}`
      }
    ],
    background: t.bg,
    flags: "layer_apply"
  })
  return { videoUrl, thumbUrl }
}

// ==== API ROUTES ====

// Health
app.get('/', (req, res) => res.send('YT SaaS Backend running: lightweight & pro'))

// (NOTE: Use strong password hash/check in production!)
app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body
  if (!email || !password || !name) return res.status(400).json({ msg: "Missing fields" })
  const u = await User.create({ email, password, name })
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET)
  res.json({ token, user: { email, name } })
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body
  const u = await User.findOne({ email }); if (!u) return res.status(400).json({ msg: "No user" })
  if (u.password !== password) return res.status(400).json({ msg: "Wrong pass" })
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET)
  res.json({ token, user: { email: u.email, name: u.name } })
})

app.get('/api/templates', (req, res) => {
  res.json({ themes: Object.keys(THEMES), niches: ["Islamic", "Motivation", "Funny", "Jokes", "Riddles"] })
})

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user })
})

app.post('/api/preferences', auth, async (req, res) => {
  req.user.preferences = req.body
  await req.user.save()
  res.json({ preferences: req.user.preferences })
})

// User requests to schedule video
app.post('/api/schedule', auth, async (req, res) => {
  // Here: create "Short" with pending status (could use cron/worker etc)
  const { theme, niche } = req.user.preferences
  const quote = generateQuote(niche)
  const topic = niche; // In real scenario, you can randomize topic per niche
  const { videoUrl, thumbUrl } = await generateVideoAndThumb({ quote, theme })
  const s = await Short.create({
    userId: req.user._id,
    quote, topic, theme, videoUrl, thumbUrl,
    status: "pending"
  })
  res.json({ msg: 'Short scheduled', shortId: s._id })
})

// See all Shorts for dashboard
app.get('/api/my-shorts', auth, async (req, res) => {
  const list = await Short.find({ userId: req.user._id }).sort('-uploadedAt').limit(50)
  res.json({ shorts: list })
})

// ==== "Lightweight Worker" -> automatic video uploads ====
// You can call this endpoint on cron via cron-job.org or Render cron for periodic batch processing.
app.post('/api/worker-run', async (req, res) => {
  const shorts = await Short.find({ status: "pending" }).limit(5)
  for (let s of shorts) {
    // Simulate YouTube upload by marking as done and updating uploadedAt
    s.status = "done"
    s.uploadedAt = new Date()
    await s.save()
  }
  res.json({ msg: `Processed ${shorts.length} shorts.` })
})

// ===== START SERVER =====
const PORT = process.env.PORT || 4000
mongoose.connect(process.env.MONGO_URI, {})
  .then(() => app.listen(PORT, () => console.log(`YT SaaS API on ${PORT}`)))
  .catch(e => console.error(e))
