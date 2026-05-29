import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { google } from 'googleapis'

const app = express()

// ===== Middleware =====
app.use(cors({
  origin: [
    'https://auto-tube-beta.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true
}))

app.use(express.json())

// ===== Error Handler =====
app.use((err, req, res, next) => {
  console.error('[ERROR]', err)

  if (res.headersSent) {
    return next(err)
  }

  res.status(500).json({
    msg: err.message || 'Internal Server Error'
  })
})

// ===== MongoDB =====
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected')
  })
  .catch((err) => {
    console.error('Mongo Error:', err.message)
  })

// ===== Schemas =====
const ytAccountSchema = new mongoose.Schema({
  email: String,
  channelId: String,
  channelTitle: String,
  profileImg: String,
  refresh_token: String
}, { _id: false })

const userSchema = new mongoose.Schema({
  name: String,

  email: {
    type: String,
    unique: true
  },

  password: String,

  ytAccounts: [ytAccountSchema],

  selectedAccount: {
    type: Number,
    default: 0
  }
})

const User = mongoose.model('User', userSchema)

// ===== Auth Middleware =====
const auth = async (req, res, next) => {
  try {

    const token = req.header('Authorization')
      ?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({
        msg: 'No token provided'
      })
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    )

    const user = await User.findById(decoded.id)

    if (!user) {
      return res.status(401).json({
        msg: 'User not found'
      })
    }

    req.user = user

    next()

  } catch (err) {

    res.status(401).json({
      msg: 'Unauthorized'
    })

  }
}

// ===== OAuth Client =====
function getOAuth2Client() {

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.YT_OAUTH_REDIRECT
  )

}

// ===== Health =====
app.get('/', (req, res) => {
  res.send('Backend Running ✅')
})

// ===== Signup =====
app.post('/api/signup', async (req, res) => {

  try {

    const { name, email, password } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({
        msg: 'All fields required'
      })
    }

    const exists = await User.findOne({ email })

    if (exists) {
      return res.status(400).json({
        msg: 'Email already exists'
      })
    }

    const hash = await bcrypt.hash(password, 12)

    const user = await User.create({
      name,
      email,
      password: hash,
      ytAccounts: []
    })

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET
    )

    res.json({
      token,
      user: {
        name: user.name,
        email: user.email
      }
    })

  } catch (err) {

    res.status(500).json({
      msg: err.message
    })

  }

})

// ===== Login =====
app.post('/api/login', async (req, res) => {

  try {

    const { email, password } = req.body

    const user = await User.findOne({ email })

    if (!user) {
      return res.status(400).json({
        msg: 'User not found'
      })
    }

    const valid = await bcrypt.compare(
      password,
      user.password
    )

    if (!valid) {
      return res.status(400).json({
        msg: 'Wrong password'
      })
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET
    )

    res.json({
      token,
      user: {
        name: user.name,
        email: user.email
      }
    })

  } catch (err) {

    res.status(500).json({
      msg: err.message
    })

  }

})

// ===== Current User =====
app.get('/api/me', auth, async (req, res) => {

  try {

    res.json({
      user: {
        name: req.user.name,
        email: req.user.email,
        ytAccounts: req.user.ytAccounts,
        selectedAccount: req.user.selectedAccount
      }
    })

  } catch (err) {

    res.status(500).json({
      msg: err.message
    })

  }

})

// ===== YouTube Connect =====
app.get('/api/youtube/connect', auth, (req, res) => {

  try {

    const client = getOAuth2Client()

    const url = client.generateAuthUrl({

      access_type: 'offline',

      prompt: 'consent',

      include_granted_scopes: true,

      scope: [

        'openid',
        'email',
        'profile',

        'https://www.googleapis.com/auth/youtube.upload',

        'https://www.googleapis.com/auth/youtube.readonly',

        'https://www.googleapis.com/auth/youtube.force-ssl'

      ]

    })

    res.json({ url })

  } catch (err) {

    res.status(500).json({
      msg: err.message
    })

  }

})

// ===== YouTube Callback =====
app.post('/api/youtube/callback', auth, async (req, res) => {

  try {

    const { code } = req.body

    if (!code) {
      return res.status(400).json({
        msg: 'Code missing'
      })
    }

    const client = getOAuth2Client()

    const { tokens } = await client.getToken(code)

    client.setCredentials(tokens)

    await client.getAccessToken()

    // ===== Google User =====
    const oauth2 = google.oauth2({
      version: 'v2',
      auth: client
    })

    const profile = await oauth2.userinfo.get()

    // ===== YouTube Info =====
    const youtube = google.youtube({
      version: 'v3',
      auth: client
    })

    const channels = await youtube.channels.list({
      mine: true,
      part: ['snippet']
    })

    const channel = channels.data.items?.[0]

    if (!channel) {
      return res.status(400).json({
        msg: 'No YouTube channel found'
      })
    }

    // ===== Prevent Duplicate =====
    const exists = req.user.ytAccounts.find(
      acc => acc.channelId === channel.id
    )

    if (!exists) {

      req.user.ytAccounts.push({

        email: profile.data.email,

        channelId: channel.id,

        channelTitle: channel.snippet?.title || '',

        profileImg:
          channel.snippet?.thumbnails?.default?.url || '',

        refresh_token: tokens.refresh_token || ''

      })

      req.user.selectedAccount =
        req.user.ytAccounts.length - 1

      await req.user.save()

    }

    res.json({
      msg: 'YouTube Connected Successfully',
      ytAccounts: req.user.ytAccounts,
      selectedAccount: req.user.selectedAccount
    })

  } catch (err) {

    console.error(err)

    res.status(400).json({
      msg: 'OAuth failed: ' + err.message
    })

  }

})

// ===== Switch Account =====
app.post('/api/youtube/switch', auth, async (req, res) => {

  try {

    const { idx } = req.body

    if (
      idx == null ||
      idx < 0 ||
      idx >= req.user.ytAccounts.length
    ) {

      return res.status(400).json({
        msg: 'Invalid account index'
      })

    }

    req.user.selectedAccount = idx

    await req.user.save()

    res.json({
      selected: idx
    })

  } catch (err) {

    res.status(500).json({
      msg: err.message
    })

  }

})

// ===== Disconnect Account =====
app.post('/api/youtube/disconnect', auth, async (req, res) => {

  try {

    const { idx } = req.body

    if (
      idx == null ||
      idx < 0 ||
      idx >= req.user.ytAccounts.length
    ) {

      return res.status(400).json({
        msg: 'Invalid account index'
      })

    }

    req.user.ytAccounts.splice(idx, 1)

    if (
      req.user.selectedAccount >=
      req.user.ytAccounts.length
    ) {
      req.user.selectedAccount = 0
    }

    await req.user.save()

    res.json({
      ytAccounts: req.user.ytAccounts,
      selectedAccount: req.user.selectedAccount
    })

  } catch (err) {

    res.status(500).json({
      msg: err.message
    })

  }

})

// ===== Start Server =====
const PORT = process.env.PORT || 4000

app.listen(PORT, () => {
  console.log(`Server Running On Port ${PORT}`)
})
