import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { google } from 'googleapis'

// ======================================================
// APP
// ======================================================

const app = express()

// ======================================================
// ENV CHECK
// ======================================================

const requiredEnv = [

  'MONGO_URI',
  'JWT_SECRET',

  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',

  'YT_OAUTH_REDIRECT'

]

for (const key of requiredEnv) {

  if (!process.env[key]) {

    console.error(
      `❌ Missing ENV: ${key}`
    )

    process.exit(1)
  }
}

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors({

  origin: [

    'https://auto-tube-beta.vercel.app',

    'http://localhost:3000',

    'http://127.0.0.1:5500'

  ],

  credentials: true

}))

app.use(express.json({

  limit: '10mb'

}))

// ======================================================
// REQUEST LOGGER
// ======================================================

app.use((req, res, next) => {

  console.log(

    `[${new Date().toISOString()}]`,

    req.method,

    req.url

  )

  next()
})

// ======================================================
// MONGODB
// ======================================================

mongoose.set('strictQuery', true)

mongoose.connect(process.env.MONGO_URI)

.then(() => {

  console.log(
    '✅ MongoDB Connected'
  )

})

.catch((err) => {

  console.error(
    '❌ MongoDB Error:',
    err.message
  )

  process.exit(1)
})

// ======================================================
// SCHEMAS
// ======================================================

// ======================
// USER
// ======================

const userSchema =
new mongoose.Schema({

  name: {

    type: String,

    required: true,

    trim: true

  },

  email: {

    type: String,

    required: true,

    unique: true,

    lowercase: true,

    trim: true

  },

  password: {

    type: String,

    required: true

  }

}, {

  timestamps: true

})

// ======================
// CHANNEL
// ======================

const channelSchema =
new mongoose.Schema({

  userId: {

    type: mongoose.Schema.Types.ObjectId,

    ref: 'User',

    required: true

  },

  email: String,

  channelId: {

    type: String,

    required: true

  },

  channelTitle: String,

  profileImg: String,

  refresh_token: String

}, {

  timestamps: true

})

channelSchema.index({

  userId: 1,
  channelId: 1

}, {

  unique: true

})

// ======================
// PROJECT
// ======================

const projectSchema =
new mongoose.Schema({

  userId: {

    type: mongoose.Schema.Types.ObjectId,

    ref: 'User',

    required: true

  },

  channelId: {

    type: mongoose.Schema.Types.ObjectId,

    ref: 'Channel',

    required: true

  },

  name: {

    type: String,

    required: true

  },

  niche: {

    type: String,

    required: true

  },

  topics: {

    type: [String],

    default: []

  },

  theme: {

    type: String,

    default: 'default'

  },

  uploadsPerDay: {

    type: Number,

    default: 1

  },

  privacy: {

    type: String,

    default: 'public'

  },

  status: {

    type: String,

    default: 'active'

  }

}, {

  timestamps: true

})

// ======================
// JOB
// ======================

const jobSchema =
new mongoose.Schema({

  projectId: {

    type: mongoose.Schema.Types.ObjectId,

    ref: 'Project'

  },

  status: {

    type: String,

    default: 'pending'

  },

  error: String

}, {

  timestamps: true

})

// ======================
// UPLOAD
// ======================

const uploadSchema =
new mongoose.Schema({

  projectId: {

    type: mongoose.Schema.Types.ObjectId,

    ref: 'Project'

  },

  title: String,

  quote: String,

  niche: String,

  topic: String,

  videoId: String,

  videoUrl: String

}, {

  timestamps: true

})

// ======================================================
// MODELS
// ======================================================

const User =
mongoose.model(
  'User',
  userSchema
)

const Channel =
mongoose.model(
  'Channel',
  channelSchema
)

const Project =
mongoose.model(
  'Project',
  projectSchema
)

const Job =
mongoose.model(
  'Job',
  jobSchema
)

const Upload =
mongoose.model(
  'Upload',
  uploadSchema
)

// ======================================================
// HELPERS
// ======================================================

function createToken(id) {

  return jwt.sign(

    { id },

    process.env.JWT_SECRET,

    {

      expiresIn: '30d'

    }
  )
}

function getOAuth2Client() {

  return new google.auth.OAuth2(

    process.env.GOOGLE_CLIENT_ID,

    process.env.GOOGLE_CLIENT_SECRET,

    process.env.YT_OAUTH_REDIRECT
  )
}

// ======================================================
// AUTH MIDDLEWARE
// ======================================================

async function auth(
  req,
  res,
  next
) {

  try {

    const token =
    req.header('Authorization')
    ?.replace('Bearer ', '')

    if (!token) {

      return res.status(401).json({

        msg: 'No token provided'

      })
    }

    const decoded =
    jwt.verify(

      token,

      process.env.JWT_SECRET
    )

    const user =
    await User.findById(
      decoded.id
    )

    if (!user) {

      return res.status(401).json({

        msg: 'User not found'

      })
    }

    req.user = user

    next()

  } catch (err) {

    console.error(err)

    res.status(401).json({

      msg: 'Unauthorized'

    })
  }
}

// ======================================================
// HEALTH
// ======================================================

app.get('/', (req, res) => {

  res.send(
    'Backend Running ✅'
  )
})

// ======================================================
// SIGNUP
// ======================================================

app.post(
  '/api/signup',

  async (req, res) => {

    try {

      const {

        name,
        email,
        password

      } = req.body

      if (

        !name ||
        !email ||
        !password

      ) {

        return res.status(400).json({

          msg: 'All fields required'

        })
      }

      if (password.length < 6) {

        return res.status(400).json({

          msg: 'Password too short'

        })
      }

      const exists =
      await User.findOne({

        email
      })

      if (exists) {

        return res.status(400).json({

          msg: 'Email already exists'

        })
      }

      const hash =
      await bcrypt.hash(
        password,
        12
      )

      const user =
      await User.create({

        name,
        email,
        password: hash

      })

      const token =
      createToken(
        user._id
      )

      res.json({

        token,

        user: {

          _id: user._id,

          name: user.name,

          email: user.email

        }

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// LOGIN
// ======================================================

app.post(
  '/api/login',

  async (req, res) => {

    try {

      const {

        email,
        password

      } = req.body

      if (

        !email ||
        !password

      ) {

        return res.status(400).json({

          msg: 'All fields required'

        })
      }

      const user =
      await User.findOne({

        email
      })

      if (!user) {

        return res.status(400).json({

          msg: 'User not found'

        })
      }

      const valid =
      await bcrypt.compare(

        password,

        user.password
      )

      if (!valid) {

        return res.status(400).json({

          msg: 'Wrong password'

        })
      }

      const token =
      createToken(
        user._id
      )

      res.json({

        token,

        user: {

          _id: user._id,

          name: user.name,

          email: user.email

        }

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// ME
// ======================================================

app.get(
  '/api/me',

  auth,

  async (req, res) => {

    try {

      const channels =
      await Channel.find({

        userId: req.user._id

      })

      const projects =
      await Project.find({

        userId: req.user._id

      })

      res.json({

        user: {

          _id: req.user._id,

          name: req.user.name,

          email: req.user.email

        },

        channels,

        projects

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// YOUTUBE CONNECT
// ======================================================

app.get(
  '/api/youtube/connect',

  auth,

  async (req, res) => {

    try {

      const client =
      getOAuth2Client()

      const url =
      client.generateAuthUrl({

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

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// YOUTUBE CALLBACK
// ======================================================

app.post(
  '/api/youtube/callback',

  auth,

  async (req, res) => {

    try {

      const { code } =
      req.body

      if (!code) {

        return res.status(400).json({

          msg: 'Code missing'

        })
      }

      const client =
      getOAuth2Client()

      const { tokens } =
      await client.getToken(code)

      if (!tokens.refresh_token) {

        return res.status(400).json({

          msg:
          'No refresh token received. Remove app access from Google account and reconnect.'

        })
      }

      client.setCredentials(tokens)

      const oauth2 =
      google.oauth2({

        version: 'v2',

        auth: client
      })

      const profile =
      await oauth2.userinfo.get()

      const youtube =
      google.youtube({

        version: 'v3',

        auth: client
      })

      const channels =
      await youtube.channels.list({

        mine: true,

        part: ['snippet']
      })

      const channel =
      channels.data.items?.[0]

      if (!channel) {

        return res.status(400).json({

          msg: 'No YouTube channel found'

        })
      }

      const exists =
      await Channel.findOne({

        userId: req.user._id,

        channelId: channel.id

      })

      if (exists) {

        return res.json({

          msg: 'Channel already connected',

          channel: exists

        })
      }

      const newChannel =
      await Channel.create({

        userId: req.user._id,

        email:
        profile.data.email,

        channelId:
        channel.id,

        channelTitle:
        channel.snippet?.title || '',

        profileImg:
        channel.snippet
        ?.thumbnails
        ?.default
        ?.url || '',

        refresh_token:
        tokens.refresh_token

      })

      res.json({

        msg:
        'YouTube Connected Successfully',

        channel: newChannel

      })

    } catch (err) {

      console.error(err)

      res.status(400).json({

        msg:
        'OAuth failed: ' +
        err.message

      })
    }
  }
)

// ======================================================
// GET CHANNELS
// ======================================================

app.get(
  '/api/channels',

  auth,

  async (req, res) => {

    try {

      const channels =
      await Channel.find({

        userId: req.user._id

      })

      res.json({

        channels

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// DISCONNECT CHANNEL
// ======================================================

app.delete(
  '/api/channels/:id',

  auth,

  async (req, res) => {

    try {

      const channel =
      await Channel.findOne({

        _id: req.params.id,

        userId: req.user._id

      })

      if (!channel) {

        return res.status(404).json({

          msg: 'Channel not found'

        })
      }

      await channel.deleteOne()

      res.json({

        msg:
        'Channel disconnected'

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// CREATE PROJECT
// ======================================================

app.post(
  '/api/projects',

  auth,

  async (req, res) => {

    try {

      const {

        name,

        niche,

        topics,

        theme,

        uploadsPerDay,

        privacy,

        channelId

      } = req.body

      if (

        !name ||
        !niche ||
        !channelId

      ) {

        return res.status(400).json({

          msg:
          'Missing required fields'

        })
      }

      const channel =
      await Channel.findOne({

        _id: channelId,

        userId: req.user._id

      })

      if (!channel) {

        return res.status(404).json({

          msg:
          'Channel not found'

        })
      }

      const project =
      await Project.create({

        userId: req.user._id,

        channelId,

        name,

        niche,

        topics:
        Array.isArray(topics)
        ? topics
        : [],

        theme:
        theme || 'default',

        uploadsPerDay:
        uploadsPerDay || 1,

        privacy:
        privacy || 'public'

      })

      res.json({

        msg:
        'Project created',

        project

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// GET PROJECTS
// ======================================================

app.get(
  '/api/projects',

  auth,

  async (req, res) => {

    try {

      const projects =
      await Project.find({

        userId: req.user._id

      })

      .populate('channelId')

      .sort({

        createdAt: -1

      })

      res.json({

        projects

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// DELETE PROJECT
// ======================================================

app.delete(
  '/api/projects/:id',

  auth,

  async (req, res) => {

    try {

      const project =
      await Project.findOne({

        _id: req.params.id,

        userId: req.user._id

      })

      if (!project) {

        return res.status(404).json({

          msg:
          'Project not found'

        })
      }

      await project.deleteOne()

      res.json({

        msg:
        'Project deleted'

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// TOGGLE PROJECT
// ======================================================

app.post(
  '/api/projects/toggle/:id',

  auth,

  async (req, res) => {

    try {

      const project =
      await Project.findOne({

        _id: req.params.id,

        userId: req.user._id

      })

      if (!project) {

        return res.status(404).json({

          msg:
          'Project not found'

        })
      }

      project.status =

      project.status === 'active'
      ? 'paused'
      : 'active'

      await project.save()

      res.json({

        msg:
        'Project updated',

        status:
        project.status

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// CREATE JOB
// ======================================================

app.post(
  '/api/jobs/create/:projectId',

  auth,

  async (req, res) => {

    try {

      const project =
      await Project.findOne({

        _id: req.params.projectId,

        userId: req.user._id

      })

      if (!project) {

        return res.status(404).json({

          msg:
          'Project not found'

        })
      }

      const job =
      await Job.create({

        projectId:
        project._id

      })

      res.json({

        msg:
        'Job created',

        job

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// GET UPLOADS
// ======================================================

app.get(
  '/api/uploads/:projectId',

  auth,

  async (req, res) => {

    try {

      const uploads =
      await Upload.find({

        projectId:
        req.params.projectId

      })

      .sort({

        createdAt: -1

      })

      res.json({

        uploads

      })

    } catch (err) {

      console.error(err)

      res.status(500).json({

        msg: err.message

      })
    }
  }
)

// ======================================================
// 404
// ======================================================

app.use((req, res) => {

  res.status(404).json({

    msg: 'Route not found'

  })
})

// ======================================================
// GLOBAL ERROR
// ======================================================

app.use((err, req, res, next) => {

  console.error(

    '❌ Global Error:',
    err
  )

  res.status(500).json({

    msg:
    err.message ||
    'Internal Server Error'

  })
})

// ======================================================
// START SERVER
// ======================================================

const PORT =
process.env.PORT || 4000

app.listen(PORT, () => {

  console.log(

    `🚀 Server Running On Port ${PORT}`
  )
})
