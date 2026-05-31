
import 'dotenv/config'

import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

import axios from 'axios'
import cron from 'node-cron'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'

import cloudinary from 'cloudinary'
import { google } from 'googleapis'

import renderOverlay from './renderOverlay.js'

// =====================================================

const app = express()

const PORT =
process.env.PORT || 4000

const BASE_PUBLIC_ID =
'ai-reel-bot/base_template_v5'

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors({

  origin: [
    'https://auto-tube-beta.vercel.app',
    'http://localhost:3000'
  ],

  credentials:true

}))

app.use(express.json())

// =====================================================
// CLOUDINARY
// =====================================================

cloudinary.v2.config({

  cloud_name:
  process.env.CLOUDINARY_CLOUD_NAME,

  api_key:
  process.env.CLOUDINARY_API_KEY,

  api_secret:
  process.env.CLOUDINARY_API_SECRET

})

// =====================================================
// MONGODB
// =====================================================

mongoose.connect(
  process.env.MONGO_URI
)

.then(()=>{
  console.log('MongoDB Connected')
})

.catch(err=>{
  console.log(err.message)
})

// =====================================================
// SCHEMAS
// =====================================================

const userSchema =
new mongoose.Schema({

  name:String,

  email:{
    type:String,
    unique:true
  },

  password:String

})

const channelSchema =
new mongoose.Schema({

  userId:mongoose.Schema.Types.ObjectId,

  channelId:String,

  channelTitle:String,

  profileImg:String,

  refresh_token:String

})
const projectSchema =
new mongoose.Schema({

  userId:
  mongoose.Schema.Types.ObjectId,

  channelId:
  mongoose.Schema.Types.ObjectId,

  name:String,

  niche:String,

  topics:[String],

  theme:String,

  status:{

    type:String,
    default:'active'
  },

  privacy:{

    type:String,
    default:'public'
  },

  uploadTime:{

    type:String,
    default:'18:00'
  },

  timezone:{

    type:String,
    default:'Asia/Kolkata'
  },

  lastUploadDate:{

    type:String,
    default:''
  }

})
const uploadSchema =
new mongoose.Schema({

  projectId:
  mongoose.Schema.Types.ObjectId,

  title:String,

  videoUrl:String,

  niche:String

},{
  timestamps:true
})

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

const Upload =
mongoose.model(
  'Upload',
  uploadSchema
)

// =====================================================
// HELPERS
// =====================================================

function createToken(id){

  return jwt.sign(

    { id },

    process.env.JWT_SECRET,

    {

      expiresIn:'30d'

    }
  )
}

async function auth(
  req,
  res,
  next
){

  try{

    const token =
    req.header('Authorization')
    ?.replace('Bearer ','')

    if(!token){

      return res.status(401)
      .json({

        msg:'No token'

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

    if(!user){

      return res.status(401)
      .json({

        msg:'User not found'

      })
    }

    req.user = user

    next()

  }catch(err){

    res.status(401)
    .json({

      msg:'Unauthorized'

    })
  }
}

function getOAuth2Client(){

  return new google.auth.OAuth2(

    process.env.GOOGLE_CLIENT_ID,

    process.env.GOOGLE_CLIENT_SECRET,

    process.env.YT_OAUTH_REDIRECT
  )
}

// =====================================================
// HEALTH
// =====================================================

app.get('/',(req,res)=>{

  res.send(
    'AutoTube AI Running'
  )

})

// =====================================================
// SIGNUP
// =====================================================

app.post(
  '/api/signup',
  async(req,res)=>{

    try{

      const {
        name,
        email,
        password
      } = req.body

      const exists =
      await User.findOne({
        email
      })

      if(exists){

        return res.status(400)
        .json({

          msg:'Email exists'

        })
      }

      const hash =
      await bcrypt.hash(
        password,
        10
      )

      const user =
      await User.create({

        name,
        email,
        password:hash

      })

      const token =
      createToken(
        user._id
      )

      res.json({

        token,

        user

      })

    }catch(err){

      res.status(500)
      .json({

        msg:err.message

      })
    }
})

// =====================================================
// LOGIN
// =====================================================

app.post(
  '/api/login',
  async(req,res)=>{

    try{

      const {
        email,
        password
      } = req.body

      const user =
      await User.findOne({
        email
      })

      if(!user){

        return res.status(400)
        .json({

          msg:'User not found'

        })
      }

      const valid =
      await bcrypt.compare(
        password,
        user.password
      )

      if(!valid){

        return res.status(400)
        .json({

          msg:'Wrong password'

        })
      }

      const token =
      createToken(
        user._id
      )

      res.json({

        token,

        user

      })

    }catch(err){

      res.status(500)
      .json({

        msg:err.message

      })
    }
})

// =====================================================
// YOUTUBE CONNECT
// =====================================================

app.get(
  '/api/youtube/connect',
  auth,
  async(req,res)=>{

    try{

      const client =
      getOAuth2Client()

      const url =
      client.generateAuthUrl({

        access_type:'offline',

        prompt:'consent',

        scope:[

          'openid',

          'email',

          'profile',

          'https://www.googleapis.com/auth/youtube.upload',

          'https://www.googleapis.com/auth/youtube.force-ssl'

        ]

      })

      res.json({ url })

    }catch(err){

      res.status(500)
      .json({

        msg:err.message

      })
    }
})

// =====================================================
// YOUTUBE CALLBACK
// =====================================================

app.post(
  '/api/youtube/callback',
  auth,
  async(req,res)=>{

    try{

      const { code } =
      req.body

      const client =
      getOAuth2Client()

      const { tokens } =
      await client.getToken(code)

      client.setCredentials(tokens)

      const youtube =
      google.youtube({

        version:'v3',

        auth:client

      })

      const data =
      await youtube.channels.list({

        mine:true,

        part:['snippet']

      })

      const channel =
      data.data.items?.[0]

      const saved =
      await Channel.create({

        userId:req.user._id,

        channelId:channel.id,

        channelTitle:
        channel.snippet.title,

        profileImg:
        channel.snippet
        .thumbnails
        .default
        .url,

        refresh_token:
        tokens.refresh_token

      })

      res.json({

        msg:'Connected',

        channel:saved

      })

    }catch(err){

      res.status(500)
      .json({

        msg:err.message

      })
    }
})
// =====================================================
// CHANNEL ROUTES
// PLACE THIS BELOW YOUTUBE CALLBACK ROUTE
// =====================================================

// =====================================================
// GET CHANNELS
// =====================================================

app.get(

  '/api/channels',

  auth,

  async(req,res)=>{

    try{

      const channels =
      await Channel.find({

        userId:req.user._id

      })

      res.json({

        channels
      })

    }catch(err){

      console.log(err)

      res.status(500)
      .json({

        msg:err.message
      })
    }
  }
)

// =====================================================
// DELETE CHANNEL
// =====================================================

app.delete(

  '/api/channels/:id',

  auth,

  async(req,res)=>{

    try{

      const channel =
      await Channel.findOne({

        _id:req.params.id,

        userId:req.user._id

      })

      if(!channel){

        return res.status(404)
        .json({

          msg:'Channel not found'
        })
      }

      await channel.deleteOne()

      res.json({

        msg:'Channel deleted'
      })

    }catch(err){

      console.log(err)

      res.status(500)
      .json({

        msg:err.message
      })
    }
  }
)
// =====================================================
// CREATE PROJECT
// =====================================================

app.post(

  '/api/projects',

  auth,

  async(req,res)=>{

    try{

      const project =
      await Project.create({

        userId:req.user._id,

        name:req.body.name,

        niche:req.body.niche,

        topics:req.body.topics || [],

        theme:req.body.theme || 'golden',

        privacy:req.body.privacy || 'public',

        status:'active',

        channelId:req.body.channelId,

        uploadTime:
        req.body.uploadTime || '18:00',

        timezone:
        req.body.timezone || 'Asia/Kolkata'

      })

      res.json({

        msg:'Project created',

        project

      })

    }catch(err){

      res.status(500)
      .json({

        msg:err.message

      })
    }
  }
)
// =====================================================
// GET PROJECTS
// =====================================================

app.get(
  '/api/projects',
  auth,
  async(req,res)=>{

    try{

      const projects =
      await Project.find({

        userId:req.user._id

      })

      .populate('channelId')

      res.json({

        projects

      })

    }catch(err){

      res.status(500)
      .json({

        msg:err.message

      })
    }
})
// =====================================================
// EDIT PROJECT
// =====================================================

app.put(

  '/api/projects/:id',

  auth,

  async(req,res)=>{

    try{

      const project =
      await Project.findOne({

        _id:req.params.id,

        userId:req.user._id

      })

      if(!project){

        return res.status(404)
        .json({

          msg:'Project not found'
        })
      }

      // ====================================
      // UPDATE FIELDS
      // ====================================

      project.name =
      req.body.name ||
      project.name

      project.niche =
      req.body.niche ||
      project.niche

      if(Array.isArray(req.body.topics)){

        project.topics =
        req.body.topics
      }

      project.theme =
      req.body.theme ||
      project.theme

      project.privacy =
      req.body.privacy ||
      project.privacy

      project.uploadTime =
      req.body.uploadTime ||
      project.uploadTime

      project.timezone =
      req.body.timezone ||
      project.timezone

      if(req.body.status){

        project.status =
        req.body.status
      }

      if(req.body.channelId){

        project.channelId =
        req.body.channelId
      }

      await project.save()

      res.json({

        msg:'Project updated',

        project
      })

    }catch(err){

      console.log(err)

      res.status(500)
      .json({

        msg:err.message
      })
    }
  }
)

// =====================================================
// DELETE PROJECT
// =====================================================

app.delete(

  '/api/projects/:id',

  auth,

  async(req,res)=>{

    try{

      const project =
      await Project.findOne({

        _id:req.params.id,

        userId:req.user._id

      })

      if(!project){

        return res.status(404)
        .json({

          msg:'Project not found'
        })
      }

      // ====================================
      // DELETE UPLOAD HISTORY
      // ====================================

      await Upload.deleteMany({

        projectId:project._id
      })

      // ====================================
      // DELETE PROJECT
      // ====================================

      await project.deleteOne()

      res.json({

        msg:'Project deleted'
      })

    }catch(err){

      console.log(err)

      res.status(500)
      .json({

        msg:err.message
      })
    }
  }
)





// =====================================================
// CONTENT GENERATOR
// =====================================================

async function generateContent(
  niche,
  topics
){

  let prompt = ''

  switch(niche){

    case 'motivation':

      prompt =
      `Generate short powerful motivational quote about ${topics.join(', ')}`

    break

    case 'quiz':

      prompt =
      `Generate viral short quiz question about ${topics.join(', ')}`

    break

    case 'facts':

      prompt =
      `Generate shocking fact about ${topics.join(', ')}`

    break

    default:

      prompt =
      `Generate Islamic reminder about ${topics.join(', ')}`
  }

  const res =
  await axios.post(

    'https://api.groq.com/openai/v1/chat/completions',

    {

      model:'llama-3.1-8b-instant',

      messages:[

        {

          role:'user',

          content:prompt
        }

      ]

    },

    {

      headers:{

        Authorization:
        `Bearer ${process.env.GROQ_API_KEY}`

      }
    }
  )

  return res.data
  .choices[0]
  .message
  .content
}

// =====================================================
// BACKGROUND
// =====================================================

async function generateBackground(
  output
){

  const url =

  'https://image.pollinations.ai/prompt/' +

  encodeURIComponent(
    'beautiful cinematic background'
  )

  const res =
  await axios.get(url,{

    responseType:'arraybuffer'

  })

  await fs.writeFile(
    output,
    res.data
  )
}

// =====================================================
// YOUTUBE UPLOAD
// =====================================================

async function uploadVideo({

  channel,
  videoPath,
  title,
  privacy

}){

  const oauth2 =
  new google.auth.OAuth2(

    process.env.GOOGLE_CLIENT_ID,

    process.env.GOOGLE_CLIENT_SECRET
  )

  oauth2.setCredentials({

    refresh_token:
    channel.refresh_token

  })

  const youtube =
  google.youtube({

    version:'v3',

    auth:oauth2

  })

  const res =
  await youtube.videos.insert({

    part:['snippet','status'],

    requestBody:{

      snippet:{

        title,

        description:title

      },

      status:{

        privacyStatus:
        privacy || 'public'

      }

    },

    media:{

      body:
      fs.createReadStream(
        videoPath
      )

    }

  })

  return res.data.id
}

// =====================================================
// AUTOMATION ENGINE
// =====================================================

cron.schedule(

  '*/5 * * * *',

  async()=>{

    console.log(
      'Checking Projects...'
    )

    const now =
    new Date()

    const hours =
    String(
      now.getHours()
    ).padStart(2,'0')

    const minutes =
    String(
      now.getMinutes()
    ).padStart(2,'0')

    const currentTime =
    `${hours}:${minutes}`

    const today =
    now.toISOString()
    .split('T')[0]

    const projects =
    await Project.find({

      status:'active'
    })

    for(const project of projects){

      try{

        // ============================
        // CHECK TIME
        // ============================

        if(

          project.uploadTime !==
          currentTime

        ){
          continue
        }

        // ============================
        // PREVENT DOUBLE UPLOAD
        // ============================

        if(

          project.lastUploadDate ===
          today

        ){
          continue
        }

        console.log(

          'Uploading:',

          project.name
        )

        const channel =
        await Channel.findById(

          project.channelId
        )

        if(!channel){

          console.log(
            'Channel missing'
          )

          continue
        }

        // ============================
        // AI CONTENT
        // ============================

        const text =
        await generateContent(

          project.niche,

          project.topics
        )

        // ============================
        // BACKGROUND
        // ============================

        const bg =
        path.join(

          os.tmpdir(),

          Date.now() + '.png'
        )

        await generateBackground(
          bg
        )

        // ============================
        // OVERLAY
        // ============================

        const overlay =
        path.join(

          os.tmpdir(),

          Date.now() + '.png'
        )

        await renderOverlay({

          quote:text,

          inputPng:bg,

          outputPng:overlay,

          theme:project.theme

        })

        // ============================
        // CLOUDINARY IMAGE
        // ============================

        const uploaded =
        await cloudinary.v2
        .uploader
        .upload(

          overlay,

          {

            resource_type:'image'
          }
        )

        // ============================
        // RENDER VIDEO
        // ============================

        const video =
        await cloudinary.v2
        .uploader
        .explicit(

          BASE_PUBLIC_ID,

          {

            resource_type:'video',

            eager:[{

              overlay:
              uploaded.public_id
              .replace(/\//g,':'),

              flags:'layer_apply',

              width:1080,

              height:1920,

              crop:'fill',

              format:'mp4'

            }]
          }
        )

        const mp4 =
        video.eager[0]
        .secure_url

        // ============================
        // DOWNLOAD VIDEO
        // ============================

        const localVideo =
        path.join(

          os.tmpdir(),

          Date.now() + '.mp4'
        )

        const response =
        await axios.get(mp4,{

          responseType:'stream'
        })

        const writer =
        fs.createWriteStream(
          localVideo
        )

        response.data.pipe(writer)

        await new Promise(resolve=>{

          writer.on(
            'finish',
            resolve
          )
        })

        // ============================
        // UPLOAD TO YOUTUBE
        // ============================

        const videoId =
        await uploadVideo({

          channel,

          videoPath:
          localVideo,

          title:text,

          privacy:
          project.privacy

        })

        // ============================
        // SAVE RECORD
        // ============================

        await Upload.create({

          projectId:
          project._id,

          title:text,

          videoUrl:
          `https://youtu.be/${videoId}`,

          niche:
          project.niche

        })

        // ============================
        // MARK UPLOADED
        // ============================

        project.lastUploadDate =
        today

        await project.save()

        console.log(

          'Uploaded:',
          videoId
        )

      }catch(err){

        console.log(

          'Automation Error:',

          err.message
        )
      }
    }
  }
)

// =====================================================

app.listen(PORT,()=>{

  console.log(

    `Server Running ${PORT}`
  )
})
