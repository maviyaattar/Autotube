import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import cron from 'node-cron'
import axios from 'axios'
import cloudinary from 'cloudinary'
import fs from 'fs'
import path from 'path'

const app = express()
app.use(cors())
app.use(express.json())

// ====== DB SETUP (User, Schedule, Shorts) ======
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,  // hash!
  name: String,
  youTubeAccounts: [
    {
      googleId: String,
      refresh_token: String, // OAuth
      channelId: String,
      channelTitle: String,
      profileImg: String
    }
  ],
  selectedAccount: Number,
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
  youTubeAccountId: String,
  videoId: String,
  quote: String,
  topic: String,
  theme: String,
  uploadedAt: Date,
  status: String,    // pending, done, failed
  meta: Object
})
const Short = mongoose.model('Short', shortSchema)

// ====== AUTH MIDDLEWARE ======
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

// ====== YOUTUBE OAuth Helper — Initiate + Callback ======
// (You must set up your Google Client and redirect in prod)
app.get('/api/youtube/auth-url', auth, (req, res) => {
  // Redirect user to Google auth URL
  // ...TO-DO: Generate OAuth URL with state & redirect (see googleapis docs)
  res.json({ url: 'https://accounts.google.com/o/oauth2/auth?...' })
})

app.post('/api/youtube/oauth-callback', auth, async (req, res) => {
  // Exchange code for refresh_token, add to user
  // ...TO-DO: This requires proper Google OAuth2 handling
  res.json({ msg: "YT account token saved" }) // Placeholder
})

// ====== ACCOUNT MANAGEMENT ======
app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body
  if (!email || !password || !name) return res.status(400).json({ msg: 'Missing fields' })
  const hash = await bcrypt.hash(password, 10)
  const user = await User.create({ email, password: hash, name, youTubeAccounts: [], selectedAccount: null, preferences: {} })
  res.json({ token: jwt.sign({ id: user._id }, process.env.JWT_SECRET), user: { email, name } })
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body
  const user = await User.findOne({ email })
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(400).json({ msg: 'Invalid credentials' })
  res.json({ token: jwt.sign({ id: user._id }, process.env.JWT_SECRET), user: { email, name: user.name } })
})

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user })
})

app.post('/api/profile', auth, async (req, res) => {
  Object.assign(req.user, req.body)
  await req.user.save()
  res.json({ user: req.user })
})

// ====== Preferences / SaaS Custom Setup ======
const NICHES = ['Islamic Quotes', 'Motivation', 'Funny', 'Jokes', 'Riddles', 'Tech', 'Love', 'Wisdom']
const THEMES = ['Classic', 'Minimal', 'Modern', 'Neon', 'Pastel', 'Rustic', 'Dark', 'ColorPop']

app.get('/api/templates', (req, res) => {
  res.json({ niches: NICHES, themes: THEMES })
})

app.post('/api/preferences', auth, async (req, res) => {
  // { niche, theme, uploadCount, uploadTimes }
  req.user.preferences = req.body
  await req.user.save()
  res.json({ preferences: req.user.preferences })
})

app.get('/api/preferences', auth, (req, res) => {
  res.json({ preferences: req.user.preferences })
})

// ====== Schedule Manipulation ======
app.post('/api/schedule', auth, async (req, res) => {
  // For simplicity save new preferences & times on user
  req.user.preferences.uploadCount = req.body.uploadCount
  req.user.preferences.uploadTimes = req.body.uploadTimes
  await req.user.save()
  res.json({ msg: 'Schedule updated' })
})

// ===== Show recent/upcoming shorts for dashboard =====
app.get('/api/my-shorts', auth, async (req, res) => {
  const shorts = await Short.find({ userId: req.user._id }).sort('-uploadedAt').limit(20)
  res.json({ shorts })
})

// ====== Manual trigger for test (e.g. run video builder now) ======
app.post('/api/generate', auth, async (req, res) => {
  // Mark video as pending for worker
  const short = await Short.create({
    userId: req.user._id,
    youTubeAccountId: req.user.youTubeAccounts[req.user.selectedAccount]?.googleId,
    niche: req.user.preferences.niche,
    theme: req.user.preferences.theme,
    status: 'pending'
  })
  res.json({ msg: 'Video scheduled for creation', shortId: short._id })
})

// ============ ==== BACKGROUND VIDEO WORKER ===============
// (Runs via cron or script, simplified here as inside this file)

const THEMES_CONFIG = {
  'Classic': { overlayColor: '#FBEDE0', font: 'serif' },
  'Neon':    { overlayColor: '#B6E2F9', font: 'sans-serif' },
  'Dark':    { overlayColor: '#14121C', font: 'monospace' },
  'Pastel':  { overlayColor: '#E2C2B3', font: 'sans-serif' },
  'ColorPop':{ overlayColor: '#FF22A1', font: 'modern-casual' },
  // ... extend
}
// A map for quick styling expansion

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
})

async function buildAndUploadShort(short, user) {
  // 1. Get a quote based on niche (simulate for now)
  const topic = user.preferences.niche || NICHES[0]
  const quote = `Sample quote for ${topic}`

  // 2. Generate overlay and theme (simulate for now)
  const theme = user.preferences.theme || 'Classic'
  const { overlayColor, font } = THEMES_CONFIG[theme] || THEMES_CONFIG['Classic']

  // 3. Generate background, overlay, combine with a template video (simulate)
  // [You would trigger your real video pipeline (ffmpeg, puppeteer, …)]
  // Simulate:
  await new Promise(r => setTimeout(r, 2000)) // simulate rendering

  // 4. Upload video (or use placeholder)
  const cloud_url = 'https://res.cloudinary.com/demo/video/upload/sample.mp4'
  // 5. "Upload" to YouTube (SIMULATE: assign videoId)
  const videoId = uuidv4()

  short.status = 'done'
  short.videoId = videoId
  short.quote = quote
  short.topic = topic
  short.theme = theme
  short.uploadedAt = new Date()
  short.meta = { overlayColor, font, url: cloud_url }
  await short.save()
  console.log(`[WORKER] Uploaded video for user ${user.email}, short ${short._id}`)
}

cron.schedule('*/5 * * * *', async () => {
  // Every 5 minutes: process new shorts!
  const shorts = await Short.find({ status: 'pending' }).limit(10)
  for (const short of shorts) {
    const user = await User.findById(short.userId)
    if (!user) continue
    try {
      await buildAndUploadShort(short, user)
    } catch (e) {
      short.status = 'failed'
      await short.save()
      console.error('Video generation/upload error:', e)
    }
  }
})

app.get('/', (req, res) => res.send('YT SaaS Backend is running.'))

// ====== Start Server ======
const PORT = process.env.PORT || 4000
mongoose.connect(process.env.MONGO_URI, { })
  .then(() => {
    app.listen(PORT, () => console.log('Backend ready on ' + PORT))
  })
  .catch(e => console.error(e))
